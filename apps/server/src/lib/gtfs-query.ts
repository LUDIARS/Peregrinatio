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
