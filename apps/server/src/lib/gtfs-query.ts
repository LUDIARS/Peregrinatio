// 取り込んだ GTFS から「近くの停留所」「停留所の発車時刻ボード」を引く。
// 運行日(曜日 + calendar_dates 例外)を考慮して、その日に走る便だけを返す。

import { sql } from '../db/index.js';
import { haversineMeters } from './segment-mode.js';

export interface GtfsStopHit {
  feed_id: string;
  feed_name: string;
  stop_id: string;
  stop_name: string | null;
  lat: number | null;
  lng: number | null;
  distance_m: number;
}

export interface GtfsDeparture {
  departure_time: string | null;
  route_name: string | null;
  headsign: string | null;
  route_type: number | null;
}

const WEEKDAY_COL = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface GtfsRouteRow {
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  route_type: number | null;
  trip_count: number;
}

/** フィードの路線一覧 (便数つき、便の多い順)。 */
export async function listRoutes(feedId: string): Promise<GtfsRouteRow[]> {
  return (await sql`
    SELECT r.route_id, r.short_name, r.long_name, r.route_type,
           (SELECT COUNT(*) FROM gtfs_trips t WHERE t.feed_id = r.feed_id AND t.route_id = r.route_id) AS trip_count
    FROM gtfs_routes r WHERE r.feed_id = ${feedId}
    ORDER BY trip_count DESC, r.short_name`) as GtfsRouteRow[];
}

export interface TimetableStop { stop_id: string; stop_name: string | null; lat: number | null; lng: number | null; }
export interface TimetableTrip { trip_id: string; headsign: string | null; service_id: string | null; times: (string | null)[]; }
/** 同じ停車順序 (パターン) でまとめた時刻表。stops=横軸、trips=縦軸 (時刻順)。 */
export interface TimetablePattern {
  direction_id: number | null;
  headsign: string | null;
  stops: TimetableStop[];
  trips: TimetableTrip[];
}

/**
 * 路線の時刻表を停車パターン別に組む。停車順序が同じ便を 1 つの表にまとめる
 * (停車順=横軸の駅/停留所、便=縦軸を時刻順)。
 */
export async function routeTimetable(feedId: string, routeId: string): Promise<TimetablePattern[]> {
  const rows = (await sql`
    SELECT st.trip_id AS trip_id, st.stop_id AS stop_id, st.departure_time AS departure_time,
           t.headsign AS headsign, t.direction_id AS direction_id, t.service_id AS service_id
    FROM gtfs_stop_times st
    JOIN gtfs_trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    WHERE st.feed_id = ${feedId} AND t.route_id = ${routeId}
    ORDER BY st.trip_id, st.stop_sequence`) as Array<{
    trip_id: string; stop_id: string; departure_time: string | null;
    headsign: string | null; direction_id: number | null; service_id: string | null;
  }>;
  if (rows.length === 0) return [];

  // trip ごとに停車順 (stop_id 列) と時刻列を作る。
  interface TripAgg { headsign: string | null; direction_id: number | null; service_id: string | null; stops: string[]; times: (string | null)[]; }
  const trips = new Map<string, TripAgg>();
  for (const r of rows) {
    let a = trips.get(r.trip_id);
    if (!a) { a = { headsign: r.headsign, direction_id: r.direction_id, service_id: r.service_id, stops: [], times: [] }; trips.set(r.trip_id, a); }
    a.stops.push(r.stop_id);
    a.times.push(r.departure_time);
  }

  // 停車順が同じ便を 1 パターンにまとめる。
  interface PatAgg { direction_id: number | null; headsign: string | null; stopSeq: string[]; trips: TimetableTrip[]; }
  const pats = new Map<string, PatAgg>();
  for (const [tripId, a] of trips) {
    const sig = a.stops.join('>');
    let p = pats.get(sig);
    if (!p) { p = { direction_id: a.direction_id, headsign: a.headsign, stopSeq: a.stops, trips: [] }; pats.set(sig, p); }
    p.trips.push({ trip_id: tripId, headsign: a.headsign, service_id: a.service_id, times: a.times });
  }

  // 停留所名/座標をまとめて解決。
  const allStopIds = new Set<string>();
  for (const p of pats.values()) for (const s of p.stopSeq) allStopIds.add(s);
  const stopRows = (await sql`
    SELECT stop_id, stop_name, lat, lng FROM gtfs_stops WHERE feed_id = ${feedId}`) as Array<{
    stop_id: string; stop_name: string | null; lat: number | null; lng: number | null;
  }>;
  const stopMap = new Map(stopRows.map((s) => [s.stop_id, s]));

  const firstTime = (t: TimetableTrip) => t.times.find((x) => x) ?? '99:99:99';
  const out: TimetablePattern[] = [];
  for (const p of pats.values()) {
    p.trips.sort((a, b) => firstTime(a).localeCompare(firstTime(b)));
    out.push({
      direction_id: p.direction_id,
      headsign: p.headsign,
      stops: p.stopSeq.map((id) => {
        const s = stopMap.get(id);
        return { stop_id: id, stop_name: s?.stop_name ?? id, lat: s?.lat ?? null, lng: s?.lng ?? null };
      }),
      trips: p.trips,
    });
  }
  // 便数の多いパターンを先頭に。
  out.sort((a, b) => b.trips.length - a.trips.length);
  return out;
}

/** lat/lng 近傍の停留所を距離順に返す (全フィード横断、bbox 前絞り→ハバーサイン)。 */
export async function nearbyStops(
  lat: number, lng: number, radiusM: number, limit: number,
): Promise<GtfsStopHit[]> {
  // 緯度 1度≈111km。経度は緯度補正。bbox で粗く絞ってから距離計算する。
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const rows = (await sql`
    SELECT s.feed_id, f.name AS feed_name, s.stop_id, s.stop_name, s.lat, s.lng
    FROM gtfs_stops s JOIN gtfs_feeds f ON f.id = s.feed_id
    WHERE s.lat BETWEEN ${lat - dLat} AND ${lat + dLat}
      AND s.lng BETWEEN ${lng - dLng} AND ${lng + dLng}`) as Array<{
    feed_id: string; feed_name: string; stop_id: string; stop_name: string | null; lat: number | null; lng: number | null;
  }>;
  const hits: GtfsStopHit[] = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const d = haversineMeters({ lat, lng }, { lat: r.lat, lng: r.lng });
    if (d <= radiusM) hits.push({ ...r, distance_m: Math.round(d) });
  }
  hits.sort((a, b) => a.distance_m - b.distance_m);
  return hits.slice(0, limit);
}

/** その日 (YYYYMMDD) に運行する service_id 集合 (calendar の曜日 + calendar_dates 例外)。 */
async function activeServiceIds(feedId: string, date: string, weekday: number): Promise<Set<string>> {
  const col = WEEKDAY_COL[weekday]!;
  // 通常運行日 (曜日フラグ=1 かつ 期間内)。列名は固定集合なので埋め込み可。
  const base = (await sql.unsafe(
    `SELECT service_id FROM gtfs_calendar
     WHERE feed_id = ? AND ${col} = 1 AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)`,
    [feedId, date, date],
  )) as { service_id: string }[];
  const set = new Set(base.map((r) => r.service_id));

  // 例外: 1=運行追加, 2=運休。
  const ex = (await sql`
    SELECT service_id, exception_type FROM gtfs_calendar_dates
    WHERE feed_id = ${feedId} AND date = ${date}`) as { service_id: string; exception_type: number }[];
  for (const e of ex) {
    if (e.exception_type === 1) set.add(e.service_id);
    else if (e.exception_type === 2) set.delete(e.service_id);
  }
  return set;
}

/**
 * 停留所の発車時刻ボード。date(YYYYMMDD) に走る便のうち after(HH:MM:SS) 以降を時刻順に。
 */
export async function stopDepartures(
  feedId: string, stopId: string, date: string, after: string, limit: number,
): Promise<GtfsDeparture[]> {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const active = await activeServiceIds(feedId, date, weekday);
  if (active.size === 0) return [];

  // stop_times を trips/routes と結合し、運行 service だけ・after 以降を返す。
  const rows = (await sql`
    SELECT st.departure_time AS departure_time, t.service_id AS service_id, t.headsign AS headsign,
           r.short_name AS short_name, r.long_name AS long_name, r.route_type AS route_type
    FROM gtfs_stop_times st
    JOIN gtfs_trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    LEFT JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    WHERE st.feed_id = ${feedId} AND st.stop_id = ${stopId}
      AND st.departure_time IS NOT NULL AND st.departure_time >= ${after}
    ORDER BY st.departure_time
    LIMIT ${Math.max(limit * 4, 80)}`) as Array<{
    departure_time: string | null; service_id: string | null; headsign: string | null;
    short_name: string | null; long_name: string | null; route_type: number | null;
  }>;

  const out: GtfsDeparture[] = [];
  for (const r of rows) {
    if (r.service_id && !active.has(r.service_id)) continue; // その日走らない便を除外
    out.push({
      departure_time: r.departure_time,
      route_name: r.short_name ?? r.long_name ?? null,
      headsign: r.headsign,
      route_type: r.route_type,
    });
    if (out.length >= limit) break;
  }
  return out;
}
