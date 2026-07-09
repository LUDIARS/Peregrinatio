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

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}

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

/** フィードの全停留所 (1 マップに全部出す用)。 */
export async function feedStops(feedId: string): Promise<TimetableStop[]> {
  return (await sql`
    SELECT stop_id, stop_name, lat, lng FROM gtfs_stops
    WHERE feed_id = ${feedId} AND lat IS NOT NULL AND lng IS NOT NULL`) as TimetableStop[];
}

export interface TimetableTrip { trip_id: string; headsign: string | null; service_id: string | null; times: (string | null)[]; }
/** 同じ停車順序 (パターン) でまとめた時刻表。stops=横軸、trips=縦軸 (時刻順)。 */
export interface TimetablePattern {
  direction_id: number | null;
  headsign: string | null;
  stops: TimetableStop[];
  trips: TimetableTrip[];
}

export interface RouteTimetableResult {
  /** 実際に絞り込んだ運行日 (YYYYMMDD)。 */
  date: string;
  patterns: TimetablePattern[];
}

/**
 * 路線の時刻表を「指定日 (date=YYYYMMDD) に運行する便」だけで停車パターン別に組む。
 * 停車順序が同じ便を 1 つの表にまとめる (停車順=横軸の停留所、便=縦軸を時刻順)。
 * 日で絞ることで、平日/土日祝/特別ダイヤなど別ダイヤの便が混ざらない
 * (calendar の曜日 + calendar_dates の例外で運行日を判定)。
 */
export async function routeTimetable(feedId: string, routeId: string, date: string): Promise<RouteTimetableResult> {
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
  if (rows.length === 0) return { date, patterns: [] };

  // 指定日に運行する service だけ通す (曜日 + calendar_dates 例外)。
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6));
  const da = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  const active = await activeServiceIds(feedId, date, weekday);

  // trip ごとに停車順 (stop_id 列) と時刻列を作る (運行日の便のみ。service 無しは含める)。
  interface TripAgg { headsign: string | null; direction_id: number | null; service_id: string | null; stops: string[]; times: (string | null)[]; }
  const trips = new Map<string, TripAgg>();
  for (const r of rows) {
    if (r.service_id && !active.has(r.service_id)) continue;
    let a = trips.get(r.trip_id);
    if (!a) { a = { headsign: r.headsign, direction_id: r.direction_id, service_id: r.service_id, stops: [], times: [] }; trips.set(r.trip_id, a); }
    a.stops.push(r.stop_id);
    a.times.push(r.departure_time);
  }
  if (trips.size === 0) return { date, patterns: [] };

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
  return { date, patterns: out };
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

export interface GtfsConnection {
  feed_id: string;
  feed_name: string;
  trip_id: string;
  route_name: string | null;
  headsign: string | null;
  route_type: number | null;
  origin_stop_id: string;
  origin_stop_name: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_stop_id: string;
  dest_stop_name: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  departure_time: string;
  arrival_time: string;
  travel_min: number | null;
}

function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function connectionSortKey(row: GtfsConnection): number {
  return timeToMinutes(row.departure_time) ?? 99_999;
}

/**
 * GTFS の同一便で origin 停留所群から dest 停留所群へ移動できる候補を返す。
 * route_type=3(バス)を優先し、route_type が欠けているフィードは取りこぼさない。
 */
export async function findStopConnections(
  feedId: string,
  originStopIds: readonly string[],
  destStopIds: readonly string[],
  date: string,
  opts: {
    departureAfter?: string;
    departureBefore?: string;
    arrivalBefore?: string;
    routeTypes?: readonly number[];
    limit?: number;
  } = {},
): Promise<GtfsConnection[]> {
  const origins = [...new Set(originStopIds)].filter(Boolean);
  const dests = [...new Set(destStopIds)].filter(Boolean);
  if (origins.length === 0 || dests.length === 0) return [];

  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const active = await activeServiceIds(feedId, date, weekday);
  if (active.size === 0) return [];

  const routeTypes = opts.routeTypes ?? [3];
  const params: unknown[] = [feedId, ...origins, ...dests];
  let routeWhere = '';
  if (routeTypes.length > 0) {
    routeWhere = `AND (r.route_type IS NULL OR r.route_type IN (${placeholders(routeTypes)}))`;
    params.push(...routeTypes);
  }
  let timeWhere = '';
  if (opts.departureAfter) {
    timeWhere += ' AND o.departure_time >= ?';
    params.push(opts.departureAfter);
  }
  if (opts.departureBefore) {
    timeWhere += ' AND o.departure_time <= ?';
    params.push(opts.departureBefore);
  }
  if (opts.arrivalBefore) {
    timeWhere += ' AND COALESCE(d.arrive_time, d.departure_time) <= ?';
    params.push(opts.arrivalBefore);
  }
  const scanLimit = Math.max((opts.limit ?? 20) * 8, 80);
  params.push(scanLimit);

  const rows = (await sql.unsafe(
    `SELECT o.feed_id AS feed_id, f.name AS feed_name, o.trip_id AS trip_id,
            t.service_id AS service_id, t.headsign AS headsign,
            r.short_name AS short_name, r.long_name AS long_name, r.route_type AS route_type,
            o.stop_id AS origin_stop_id, os.stop_name AS origin_stop_name,
            os.lat AS origin_lat, os.lng AS origin_lng,
            d.stop_id AS dest_stop_id, ds.stop_name AS dest_stop_name,
            ds.lat AS dest_lat, ds.lng AS dest_lng,
            o.departure_time AS departure_time,
            COALESCE(d.arrive_time, d.departure_time) AS arrival_time
     FROM gtfs_stop_times o
     JOIN gtfs_stop_times d
       ON d.feed_id = o.feed_id
      AND d.trip_id = o.trip_id
      AND COALESCE(d.stop_sequence, 999999) > COALESCE(o.stop_sequence, -1)
     JOIN gtfs_trips t ON t.feed_id = o.feed_id AND t.trip_id = o.trip_id
     JOIN gtfs_feeds f ON f.id = o.feed_id
     LEFT JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
     LEFT JOIN gtfs_stops os ON os.feed_id = o.feed_id AND os.stop_id = o.stop_id
     LEFT JOIN gtfs_stops ds ON ds.feed_id = d.feed_id AND ds.stop_id = d.stop_id
     WHERE o.feed_id = ?
       AND o.stop_id IN (${placeholders(origins)})
       AND d.stop_id IN (${placeholders(dests)})
       AND o.departure_time IS NOT NULL
       AND COALESCE(d.arrive_time, d.departure_time) IS NOT NULL
       ${routeWhere}
       ${timeWhere}
     ORDER BY o.departure_time
     LIMIT ?`,
    params,
  )) as Array<{
    feed_id: string; feed_name: string; trip_id: string; service_id: string | null;
    headsign: string | null; short_name: string | null; long_name: string | null; route_type: number | null;
    origin_stop_id: string; origin_stop_name: string | null; origin_lat: number | null; origin_lng: number | null;
    dest_stop_id: string; dest_stop_name: string | null; dest_lat: number | null; dest_lng: number | null;
    departure_time: string | null; arrival_time: string | null;
  }>;

  const out: GtfsConnection[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.service_id && !active.has(r.service_id)) continue;
    if (!r.departure_time || !r.arrival_time) continue;
    const key = `${r.trip_id}|${r.origin_stop_id}|${r.dest_stop_id}|${r.departure_time}|${r.arrival_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dep = timeToMinutes(r.departure_time);
    const arr = timeToMinutes(r.arrival_time);
    out.push({
      feed_id: r.feed_id,
      feed_name: r.feed_name,
      trip_id: r.trip_id,
      route_name: r.short_name ?? r.long_name ?? null,
      headsign: r.headsign,
      route_type: r.route_type,
      origin_stop_id: r.origin_stop_id,
      origin_stop_name: r.origin_stop_name,
      origin_lat: r.origin_lat,
      origin_lng: r.origin_lng,
      dest_stop_id: r.dest_stop_id,
      dest_stop_name: r.dest_stop_name,
      dest_lat: r.dest_lat,
      dest_lng: r.dest_lng,
      departure_time: r.departure_time,
      arrival_time: r.arrival_time,
      travel_min: dep == null || arr == null ? null : arr - dep,
    });
    if (out.length >= (opts.limit ?? 20)) break;
  }
  out.sort((a, b) => connectionSortKey(a) - connectionSortKey(b));
  return out;
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

export type ServiceDayKind = 'weekday' | 'weekend' | 'holiday';

export interface GtfsRouteSummary {
  feed_id: string;
  feed_name: string;
  route_id: string;
  route_label: string;
  short_name: string | null;
  long_name: string | null;
  route_type: number | null;
  trip_count: number;
  weekday_trip_count: number;
  weekend_trip_count: number;
  holiday_trip_count: number;
  holiday_sample_date: string | null;
  limited: boolean;
}

function routeName(shortName: string | null, longName: string | null, fallback: string): string {
  return [shortName, longName].filter(Boolean).join(' ') || fallback;
}

/** 取込済みデータを横断した路線一覧。UI ではフィード由来を前面に出さず、この一覧を使う。 */
export async function listRouteSummaries(): Promise<GtfsRouteSummary[]> {
  const rows = (await sql`
    SELECT f.id AS feed_id, f.name AS feed_name,
           r.route_id AS route_id, r.short_name AS short_name, r.long_name AS long_name, r.route_type AS route_type,
           COUNT(t.trip_id) AS trip_count,
           SUM(CASE
             WHEN t.trip_id IS NULL THEN 0
             WHEN t.service_id IS NULL OR c.service_id IS NULL THEN 1
             WHEN COALESCE(c.mon, 0) = 1 OR COALESCE(c.tue, 0) = 1 OR COALESCE(c.wed, 0) = 1 OR COALESCE(c.thu, 0) = 1 OR COALESCE(c.fri, 0) = 1 THEN 1
             ELSE 0 END) AS weekday_trip_count,
           SUM(CASE
             WHEN t.trip_id IS NULL THEN 0
             WHEN t.service_id IS NULL OR c.service_id IS NULL THEN 1
             WHEN COALESCE(c.sat, 0) = 1 OR COALESCE(c.sun, 0) = 1 THEN 1
             ELSE 0 END) AS weekend_trip_count,
           SUM(CASE
             WHEN t.trip_id IS NULL THEN 0
             WHEN EXISTS (
               SELECT 1 FROM gtfs_calendar_dates cd
               WHERE cd.feed_id = t.feed_id AND cd.service_id = t.service_id AND cd.exception_type = 1
             ) THEN 1
             ELSE 0 END) AS holiday_trip_count
           ,
           MIN((
             SELECT cd.date FROM gtfs_calendar_dates cd
             WHERE cd.feed_id = t.feed_id AND cd.service_id = t.service_id AND cd.exception_type = 1
             ORDER BY cd.date
             LIMIT 1
           )) AS holiday_sample_date
    FROM gtfs_routes r
    JOIN gtfs_feeds f ON f.id = r.feed_id
    LEFT JOIN gtfs_trips t ON t.feed_id = r.feed_id AND t.route_id = r.route_id
    LEFT JOIN gtfs_calendar c ON c.feed_id = t.feed_id AND c.service_id = t.service_id
    GROUP BY f.id, f.name, r.route_id, r.short_name, r.long_name, r.route_type
    ORDER BY f.name, trip_count DESC, r.short_name, r.long_name`) as Array<{
    feed_id: string; feed_name: string; route_id: string; short_name: string | null; long_name: string | null; route_type: number | null;
    trip_count: number; weekday_trip_count: number | null; weekend_trip_count: number | null; holiday_trip_count: number | null; holiday_sample_date: string | null;
  }>;

  return rows.map((r) => {
    const weekday = Number(r.weekday_trip_count ?? 0);
    const weekend = Number(r.weekend_trip_count ?? 0);
    const holiday = Number(r.holiday_trip_count ?? 0);
    return {
      ...r,
      route_label: routeName(r.short_name, r.long_name, r.route_id),
      trip_count: Number(r.trip_count ?? 0),
      weekday_trip_count: weekday,
      weekend_trip_count: weekend,
      holiday_trip_count: holiday,
      holiday_sample_date: r.holiday_sample_date,
      limited: holiday > 0 || weekday !== weekend || weekday === 0 || weekend === 0,
    };
  });
}

export interface GtfsRouteSearchLeg extends GtfsConnection {
  transfer_wait_min: number | null;
}

export interface GtfsRouteSearchOption {
  summary: string;
  departure_time: string;
  arrival_time: string;
  duration_min: number;
  transfer_count: number;
  walk_from_m: number;
  walk_to_m: number;
  legs: GtfsRouteSearchLeg[];
}

export interface GtfsRouteSearchResult {
  date: string;
  basis: 'departure' | 'arrival';
  from_stop_count: number;
  to_stop_count: number;
  options: GtfsRouteSearchOption[];
}

function minutesToGtfs(minutes: number): string {
  const clamped = Math.max(0, minutes);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function normalizeTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return '00:00:00';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

function normalizeDate(date: string): string {
  return date.replaceAll('-', '');
}

function shortGtfsTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : time;
}

function stopKey(feedId: string, stopId: string): string {
  return `${feedId}:${stopId}`;
}

function byFeed(stops: readonly GtfsStopHit[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of stops) {
    const arr = m.get(s.feed_id) ?? [];
    arr.push(s.stop_id);
    m.set(s.feed_id, arr);
  }
  return m;
}

async function findReachableConnections(
  feedId: string,
  originStopIds: readonly string[],
  date: string,
  opts: { departureAfter: string; departureBefore: string; routeTypes?: readonly number[]; limit?: number },
): Promise<GtfsConnection[]> {
  const origins = [...new Set(originStopIds)].filter(Boolean);
  if (origins.length === 0) return [];

  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const active = await activeServiceIds(feedId, date, weekday);
  if (active.size === 0) return [];

  const routeTypes = opts.routeTypes ?? [0, 1, 2, 3];
  const params: unknown[] = [feedId, ...origins];
  let routeWhere = '';
  if (routeTypes.length > 0) {
    routeWhere = `AND (r.route_type IS NULL OR r.route_type IN (${placeholders(routeTypes)}))`;
    params.push(...routeTypes);
  }
  params.push(opts.departureAfter, opts.departureBefore, Math.max(opts.limit ?? 160, 40));

  const rows = (await sql.unsafe(
    `SELECT o.feed_id AS feed_id, f.name AS feed_name, o.trip_id AS trip_id,
            t.service_id AS service_id, t.headsign AS headsign,
            r.short_name AS short_name, r.long_name AS long_name, r.route_type AS route_type,
            o.stop_id AS origin_stop_id, os.stop_name AS origin_stop_name,
            os.lat AS origin_lat, os.lng AS origin_lng,
            d.stop_id AS dest_stop_id, ds.stop_name AS dest_stop_name,
            ds.lat AS dest_lat, ds.lng AS dest_lng,
            o.departure_time AS departure_time,
            COALESCE(d.arrive_time, d.departure_time) AS arrival_time
     FROM gtfs_stop_times o
     JOIN gtfs_stop_times d
       ON d.feed_id = o.feed_id
      AND d.trip_id = o.trip_id
      AND COALESCE(d.stop_sequence, 999999) > COALESCE(o.stop_sequence, -1)
      AND d.stop_id <> o.stop_id
     JOIN gtfs_trips t ON t.feed_id = o.feed_id AND t.trip_id = o.trip_id
     JOIN gtfs_feeds f ON f.id = o.feed_id
     LEFT JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
     LEFT JOIN gtfs_stops os ON os.feed_id = o.feed_id AND os.stop_id = o.stop_id
     LEFT JOIN gtfs_stops ds ON ds.feed_id = d.feed_id AND ds.stop_id = d.stop_id
     WHERE o.feed_id = ?
       AND o.stop_id IN (${placeholders(origins)})
       ${routeWhere}
       AND o.departure_time IS NOT NULL
       AND o.departure_time >= ?
       AND o.departure_time <= ?
       AND COALESCE(d.arrive_time, d.departure_time) IS NOT NULL
     ORDER BY o.departure_time, d.stop_sequence
     LIMIT ?`,
    params,
  )) as Array<{
    feed_id: string; feed_name: string; trip_id: string; service_id: string | null;
    headsign: string | null; short_name: string | null; long_name: string | null; route_type: number | null;
    origin_stop_id: string; origin_stop_name: string | null; origin_lat: number | null; origin_lng: number | null;
    dest_stop_id: string; dest_stop_name: string | null; dest_lat: number | null; dest_lng: number | null;
    departure_time: string | null; arrival_time: string | null;
  }>;

  const out: GtfsConnection[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.service_id && !active.has(r.service_id)) continue;
    if (!r.departure_time || !r.arrival_time) continue;
    const key = `${r.trip_id}|${r.origin_stop_id}|${r.dest_stop_id}|${r.departure_time}|${r.arrival_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dep = timeToMinutes(r.departure_time);
    const arr = timeToMinutes(r.arrival_time);
    out.push({
      feed_id: r.feed_id,
      feed_name: r.feed_name,
      trip_id: r.trip_id,
      route_name: r.short_name ?? r.long_name ?? null,
      headsign: r.headsign,
      route_type: r.route_type,
      origin_stop_id: r.origin_stop_id,
      origin_stop_name: r.origin_stop_name,
      origin_lat: r.origin_lat,
      origin_lng: r.origin_lng,
      dest_stop_id: r.dest_stop_id,
      dest_stop_name: r.dest_stop_name,
      dest_lat: r.dest_lat,
      dest_lng: r.dest_lng,
      departure_time: r.departure_time,
      arrival_time: r.arrival_time,
      travel_min: dep == null || arr == null ? null : arr - dep,
    });
  }
  out.sort((a, b) => connectionSortKey(a) - connectionSortKey(b));
  return out;
}

function optionFromLegs(
  legs: GtfsConnection[],
  fromDistances: Map<string, number>,
  toDistances: Map<string, number>,
): GtfsRouteSearchOption | null {
  if (legs.length === 0) return null;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const dep = timeToMinutes(first.departure_time);
  const arr = timeToMinutes(last.arrival_time);
  if (dep == null || arr == null || arr < dep) return null;

  const searchLegs: GtfsRouteSearchLeg[] = legs.map((leg, i) => {
    const prev = i > 0 ? legs[i - 1] : null;
    const wait = prev ? (timeToMinutes(leg.departure_time) ?? 0) - (timeToMinutes(prev.arrival_time) ?? 0) : null;
    return { ...leg, transfer_wait_min: wait == null ? null : Math.max(0, wait) };
  });
  const routes = searchLegs.map((leg) => routeName(leg.route_name, leg.headsign, '路線')).filter(Boolean);
  return {
    summary: routes.join(' → '),
    departure_time: shortGtfsTime(first.departure_time),
    arrival_time: shortGtfsTime(last.arrival_time),
    duration_min: arr - dep,
    transfer_count: Math.max(0, legs.length - 1),
    walk_from_m: fromDistances.get(stopKey(first.feed_id, first.origin_stop_id)) ?? 0,
    walk_to_m: toDistances.get(stopKey(last.feed_id, last.dest_stop_id)) ?? 0,
    legs: searchLegs,
  };
}

/**
 * 取り込み済み路線を時刻付きグラフとして検索する。Google Directions API は使わない。
 * 現時点では直通 + 1 回乗換までに絞る。UI の ZERO_RESULT 回避を優先した軽量探索。
 */
export async function searchRouteGraph(params: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  date: string;
  time: string;
  basis: 'departure' | 'arrival';
  radiusM?: number;
  limit?: number;
}): Promise<GtfsRouteSearchResult> {
  const date = normalizeDate(params.date);
  const target = timeToMinutes(normalizeTime(params.time)) ?? 0;
  const windowMin = 240;
  const departureAfter = params.basis === 'arrival' ? Math.max(0, target - windowMin) : target;
  const departureBefore = params.basis === 'arrival' ? target : target + windowMin;
  const radiusM = params.radiusM ?? 1200;
  const limit = params.limit ?? 6;

  const [fromStops, toStops] = await Promise.all([
    nearbyStops(params.from.lat, params.from.lng, radiusM, 12),
    nearbyStops(params.to.lat, params.to.lng, radiusM, 12),
  ]);
  const fromDistances = new Map(fromStops.map((s) => [stopKey(s.feed_id, s.stop_id), s.distance_m]));
  const toDistances = new Map(toStops.map((s) => [stopKey(s.feed_id, s.stop_id), s.distance_m]));
  const fromByFeed = byFeed(fromStops);
  const toByFeed = byFeed(toStops);
  const feedIds = [...fromByFeed.keys()].filter((id) => toByFeed.has(id));
  const options: GtfsRouteSearchOption[] = [];
  const seen = new Set<string>();

  for (const feedId of feedIds) {
    const origins = fromByFeed.get(feedId)!;
    const dests = toByFeed.get(feedId)!;

    const direct = await findStopConnections(feedId, origins, dests, date, {
      departureAfter: minutesToGtfs(departureAfter),
      departureBefore: minutesToGtfs(departureBefore),
      arrivalBefore: params.basis === 'arrival' ? minutesToGtfs(target) : undefined,
      routeTypes: [0, 1, 2, 3],
      limit: 20,
    });
    for (const leg of direct) {
      const opt = optionFromLegs([leg], fromDistances, toDistances);
      if (!opt) continue;
      const key = opt.legs.map((l) => `${l.trip_id}:${l.origin_stop_id}:${l.dest_stop_id}:${l.departure_time}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(opt);
    }

    const firstLegs = await findReachableConnections(feedId, origins, date, {
      departureAfter: minutesToGtfs(departureAfter),
      departureBefore: minutesToGtfs(departureBefore),
      routeTypes: [0, 1, 2, 3],
      limit: 220,
    });
    for (const leg1 of firstLegs.slice(0, 120)) {
      if (dests.includes(leg1.dest_stop_id)) continue;
      const arr1 = timeToMinutes(leg1.arrival_time);
      if (arr1 == null) continue;
      const secondDepartureAfter = arr1 + 5;
      const secondDepartureBefore = Math.min(target + windowMin, arr1 + 120);
      if (secondDepartureAfter > secondDepartureBefore) continue;
      const second = await findStopConnections(feedId, [leg1.dest_stop_id], dests, date, {
        departureAfter: minutesToGtfs(secondDepartureAfter),
        departureBefore: minutesToGtfs(secondDepartureBefore),
        arrivalBefore: params.basis === 'arrival' ? minutesToGtfs(target) : undefined,
        routeTypes: [0, 1, 2, 3],
        limit: 3,
      });
      for (const leg2 of second) {
        if (leg1.trip_id === leg2.trip_id) continue;
        const opt = optionFromLegs([leg1, leg2], fromDistances, toDistances);
        if (!opt) continue;
        const key = opt.legs.map((l) => `${l.trip_id}:${l.origin_stop_id}:${l.dest_stop_id}:${l.departure_time}`).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(opt);
      }
    }
  }

  const sorted = options
    .filter((o) => params.basis !== 'arrival' || (timeToMinutes(`${o.arrival_time}:00`) ?? 99_999) <= target)
    .sort((a, b) => {
      const aDep = timeToMinutes(`${a.departure_time}:00`) ?? 0;
      const bDep = timeToMinutes(`${b.departure_time}:00`) ?? 0;
      const aArr = timeToMinutes(`${a.arrival_time}:00`) ?? 99_999;
      const bArr = timeToMinutes(`${b.arrival_time}:00`) ?? 99_999;
      if (params.basis === 'arrival') return bDep - aDep || aArr - bArr || a.transfer_count - b.transfer_count;
      return aDep - bDep || aArr - bArr || a.transfer_count - b.transfer_count;
    })
    .slice(0, limit);

  return {
    date,
    basis: params.basis,
    from_stop_count: fromStops.length,
    to_stop_count: toStops.length,
    options: sorted,
  };
}
