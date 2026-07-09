// 時刻表 / 運行情報。データ源 (NAVITIME/駅すぱあと/ODPT 等) は未配線。
// 手入力で end-to-end 動く骨組み + fetch/refresh の差し替え口 (既定は未対応を明示)。
//   GET/POST   /api/trips/:id/timetables
//   DELETE     /api/timetables/:id
//   GET/POST   /api/timetables/:id/departures
//   DELETE     /api/departures/:id
//   POST       /api/timetables/:id/fetch              (差し替え可能・既定 501)
//   GET/POST   /api/trips/:id/service-alerts
//   POST       /api/trips/:id/service-alerts/refresh  (差し替え可能・既定 501)

import type { Context } from 'hono';
import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import { findStopConnections, nearbyStops, type GtfsConnection, type GtfsStopHit } from '../lib/gtfs-query.js';
import { config } from '../config.js';
import { defaultProviderKind, resolveProvider } from '../transit/index.js';
import { PROVIDER_KINDS, ProviderFetchError, ProviderInputError, ProviderUnavailableError } from '../transit/provider.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TimetableKind } from '../types.js';

const app = new Hono();

const VALID_KINDS: readonly TimetableKind[] = ['shinkansen', 'bus', 'train'];

const TOHOKU_SHINKANSEN_SOURCE =
  'https://www.jreast.co.jp/aas/20220318_o_kansen_j_001.pdf';
const TOHOKU_SHINKANSEN_LINE = '東北新幹線 なすの';
const NASUSHIOBARA_STATION = { name: '那須塩原', lat: 36.9317, lng: 140.0209 };
const OUTBOUND_TRANSFER_MIN = 5;
const OUTBOUND_SEARCH_MIN = 120;
const INBOUND_TRANSFER_MIN = 10;
const INBOUND_SEARCH_MIN = 180;

interface SeedDeparture {
  depart_time: string;
  arrive_time: string | null;
  train_name: string;
  note: string;
}

const TOHOKU_SHINKANSEN_NASUNO_DOWN: readonly SeedDeparture[] = [
  { depart_time: '06:20', arrive_time: '07:29', train_name: 'なすの 401号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '06:40', arrive_time: '07:49', train_name: 'なすの 403号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '07:16', arrive_time: '08:25', train_name: 'なすの 405号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '07:44', arrive_time: '08:53', train_name: 'なすの 407号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '08:08', arrive_time: '09:17', train_name: 'なすの 409号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '08:40', arrive_time: '09:49', train_name: 'なすの 413号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '09:40', arrive_time: '10:49', train_name: 'なすの 415号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '10:12', arrive_time: '11:20', train_name: 'なすの 451号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '11:08', arrive_time: '12:20', train_name: 'なすの 475号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '12:36', arrive_time: '13:45', train_name: 'なすの 417号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '13:36', arrive_time: '14:45', train_name: 'なすの 419号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '14:36', arrive_time: '15:45', train_name: 'なすの 421号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '15:36', arrive_time: '16:45', train_name: 'なすの 423号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '16:36', arrive_time: '17:45', train_name: 'なすの 427号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '17:16', arrive_time: '18:24', train_name: 'なすの 473号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '17:36', arrive_time: '18:45', train_name: 'なすの 429号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '18:08', arrive_time: '19:19', train_name: 'なすの 431号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '18:36', arrive_time: '19:45', train_name: 'なすの 433号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '19:00', arrive_time: '20:08', train_name: 'なすの 435号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '19:28', arrive_time: '20:41', train_name: 'なすの 437号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '20:00', arrive_time: '21:06', train_name: 'なすの 439号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '20:28', arrive_time: '21:36', train_name: 'なすの 441号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '21:24', arrive_time: '22:35', train_name: 'なすの 443号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '22:00', arrive_time: '23:07', train_name: 'なすの 445号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
  { depart_time: '22:44', arrive_time: '23:52', train_name: 'なすの 447号', note: 'PDF: 東北新幹線 時刻表（3/19〜）下り' },
];

const TOHOKU_SHINKANSEN_NASUNO_UP: readonly SeedDeparture[] = [
  { depart_time: '06:12', arrive_time: '07:20', train_name: 'なすの 400号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '06:24', arrive_time: '07:32', train_name: 'なすの 402号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '06:48', arrive_time: '07:56', train_name: 'なすの 404号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '06:56', arrive_time: '08:04', train_name: 'なすの 406号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '07:20', arrive_time: '08:28', train_name: 'なすの 408号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '07:36', arrive_time: '08:44', train_name: 'なすの 410号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '07:54', arrive_time: '09:04', train_name: 'なすの 412号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '08:18', arrive_time: '09:28', train_name: 'なすの 414号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '08:48', arrive_time: '10:00', train_name: 'なすの 418号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '09:49', arrive_time: '10:56', train_name: 'なすの 420号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '10:39', arrive_time: '11:48', train_name: 'なすの 472号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '11:15', arrive_time: '12:24', train_name: 'なすの 422号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '12:15', arrive_time: '13:24', train_name: 'なすの 424号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '13:15', arrive_time: '14:24', train_name: 'なすの 426号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '14:15', arrive_time: '15:24', train_name: 'なすの 428号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '15:15', arrive_time: '16:24', train_name: 'なすの 430号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '16:15', arrive_time: '17:24', train_name: 'なすの 432号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '17:15', arrive_time: '18:24', train_name: 'なすの 434号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '17:39', arrive_time: '18:48', train_name: 'なすの 436号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '18:15', arrive_time: '19:28', train_name: 'なすの 474号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '18:39', arrive_time: '19:48', train_name: 'なすの 438号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '19:35', arrive_time: '20:44', train_name: 'なすの 440号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '20:35', arrive_time: '21:44', train_name: 'なすの 442号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '21:39', arrive_time: '22:48', train_name: 'なすの 444号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
  { depart_time: '22:35', arrive_time: '23:44', train_name: 'なすの 446号', note: 'PDF: 東北新幹線 時刻表（3/19〜）上り' },
];

interface TripDateRow {
  start_date: string | null;
  end_date: string | null;
}

interface TripBusTarget {
  name: string;
  lat: number;
  lng: number;
}

interface BusSuggestion {
  direction: 'outbound' | 'inbound';
  date: string;
  shinkansen_train_name: string;
  shinkansen_depart_time: string;
  shinkansen_arrive_time: string | null;
  transfer_min: number;
  connection: GtfsConnection;
}

function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToGtfs(minutes: number): string {
  const clamped = Math.max(0, minutes);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function shortTime(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function todayGtfsDate(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10).replaceAll('-', '');
}

function toGtfsDate(date: string | null | undefined): string {
  return date ? date.replaceAll('-', '') : todayGtfsDate();
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

function routeLabel(cn: GtfsConnection): string {
  const route = cn.route_name ?? 'バス';
  return cn.headsign ? `${route} ${cn.headsign}` : route;
}

function busNote(s: BusSuggestion): string {
  const cn = s.connection;
  const section = `${cn.origin_stop_name ?? cn.origin_stop_id}→${cn.dest_stop_name ?? cn.dest_stop_id}`;
  if (s.direction === 'outbound') {
    return `接続: ${s.shinkansen_train_name} 東京 ${s.shinkansen_depart_time}→那須塩原 ${s.shinkansen_arrive_time ?? ''} / 乗換 ${s.transfer_min}分 / GTFS: ${cn.feed_name} ${section}`;
  }
  return `接続: ${s.shinkansen_train_name} 那須塩原 ${s.shinkansen_depart_time}→東京 ${s.shinkansen_arrive_time ?? ''} / 駅で乗換 ${s.transfer_min}分 / GTFS: ${cn.feed_name} ${section}`;
}

async function ensureTimetable(
  tripId: string,
  kind: TimetableKind,
  lineName: string,
  from: string,
  to: string,
  notes: string,
): Promise<Timetable> {
  const [existing] = (await sql`
    SELECT * FROM timetables
    WHERE trip_id=${tripId}
      AND kind=${kind}
      AND line_name=${lineName}
      AND from_station=${from}
      AND to_station=${to}
    ORDER BY created_at
    LIMIT 1`) as Timetable[];
  if (existing) return existing;
  const id = newId();
  await sql`INSERT INTO timetables (id, trip_id, kind, line_name, from_station, to_station, notes)
    VALUES (${id}, ${tripId}, ${kind}, ${lineName}, ${from}, ${to}, ${notes})`;
  const [created] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  return created!;
}

async function seedDepartures(timetable: Timetable, departures: readonly SeedDeparture[]): Promise<{ added: number; rows: TimetableDeparture[] }> {
  const current = (await sql`
    SELECT depart_time, train_name FROM timetable_departures WHERE timetable_id=${timetable.id}`) as {
      depart_time: string | null;
      train_name: string | null;
    }[];
  const seen = new Set(current.map((d) => `${d.depart_time ?? ''}|${d.train_name ?? ''}`));
  const [cnt] = (await sql`
    SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${timetable.id}`) as { n: number }[];
  let added = 0;
  let order = cnt?.n ?? 0;
  for (const d of departures) {
    const key = `${d.depart_time}|${d.train_name}`;
    if (seen.has(key)) continue;
    await sql`INSERT INTO timetable_departures
      (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
      VALUES (${newId()}, ${timetable.id}, ${d.depart_time}, ${d.arrive_time}, ${d.train_name},
              ${null}, ${null}, ${d.note}, ${order++})`;
    added++;
  }
  const rows = (await sql`
    SELECT * FROM timetable_departures WHERE timetable_id=${timetable.id}
    ORDER BY order_index, depart_time`) as TimetableDeparture[];
  return { added, rows };
}

async function ensureTohokuShinkansen(tripId: string): Promise<{ timetables: Timetable[]; added: number; departures: TimetableDeparture[] }> {
  let added = 0;
  const timetables: Timetable[] = [];
  const allDepartures: TimetableDeparture[] = [];

  const down = await ensureTimetable(
    tripId,
    'shinkansen',
    TOHOKU_SHINKANSEN_LINE,
    '東京',
    NASUSHIOBARA_STATION.name,
    `JR東日本「東北新幹線 時刻表（3/19〜）」参照: ${TOHOKU_SHINKANSEN_SOURCE}`,
  );
  const downSeed = await seedDepartures(down, TOHOKU_SHINKANSEN_NASUNO_DOWN);
  added += downSeed.added;
  allDepartures.push(...downSeed.rows);
  timetables.push(down);

  const up = await ensureTimetable(
    tripId,
    'shinkansen',
    TOHOKU_SHINKANSEN_LINE,
    NASUSHIOBARA_STATION.name,
    '東京',
    `JR東日本「東北新幹線 時刻表（3/19〜）」参照: ${TOHOKU_SHINKANSEN_SOURCE}`,
  );
  const upSeed = await seedDepartures(up, TOHOKU_SHINKANSEN_NASUNO_UP);
  added += upSeed.added;
  allDepartures.push(...upSeed.rows);
  timetables.push(up);

  return { timetables, added, departures: allDepartures };
}

async function tripBusTarget(tripId: string): Promise<TripBusTarget | null> {
  const [target] = (await sql`
    SELECT p.name, p.lat, p.lng
    FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id=${tripId}
      AND p.lat IS NOT NULL
      AND p.lng IS NOT NULL
    ORDER BY tp.is_base DESC, tp.added_at
    LIMIT 1`) as Array<{ name: string; lat: number | null; lng: number | null }>;
  if (!target || target.lat == null || target.lng == null) return null;
  return { name: target.name, lat: target.lat, lng: target.lng };
}

async function bestConnectionsForTrain(
  direction: 'outbound' | 'inbound',
  train: SeedDeparture,
  date: string,
  stationStops: readonly GtfsStopHit[],
  targetStops: readonly GtfsStopHit[],
): Promise<BusSuggestion | null> {
  const stationByFeed = byFeed(stationStops);
  const targetByFeed = byFeed(targetStops);
  const feedIds = [...stationByFeed.keys()].filter((id) => targetByFeed.has(id));
  const all: BusSuggestion[] = [];

  for (const feedId of feedIds) {
    if (direction === 'outbound') {
      const trainArr = timeToMinutes(train.arrive_time);
      if (trainArr == null) continue;
      const connections = await findStopConnections(feedId, stationByFeed.get(feedId)!, targetByFeed.get(feedId)!, date, {
        departureAfter: minutesToGtfs(trainArr + OUTBOUND_TRANSFER_MIN),
        departureBefore: minutesToGtfs(trainArr + OUTBOUND_SEARCH_MIN),
        limit: 12,
      });
      for (const cn of connections) {
        const dep = timeToMinutes(cn.departure_time);
        if (dep == null) continue;
        all.push({
          direction,
          date,
          shinkansen_train_name: train.train_name,
          shinkansen_depart_time: train.depart_time,
          shinkansen_arrive_time: train.arrive_time,
          transfer_min: dep - trainArr,
          connection: cn,
        });
      }
    } else {
      const trainDep = timeToMinutes(train.depart_time);
      if (trainDep == null) continue;
      const connections = await findStopConnections(feedId, targetByFeed.get(feedId)!, stationByFeed.get(feedId)!, date, {
        departureAfter: minutesToGtfs(trainDep - INBOUND_SEARCH_MIN),
        arrivalBefore: minutesToGtfs(trainDep - INBOUND_TRANSFER_MIN),
        limit: 12,
      });
      for (const cn of connections) {
        const arr = timeToMinutes(cn.arrival_time);
        if (arr == null) continue;
        all.push({
          direction,
          date,
          shinkansen_train_name: train.train_name,
          shinkansen_depart_time: train.depart_time,
          shinkansen_arrive_time: train.arrive_time,
          transfer_min: trainDep - arr,
          connection: cn,
        });
      }
    }
  }

  all.sort((a, b) =>
    a.transfer_min - b.transfer_min
    || (a.connection.travel_min ?? 99_999) - (b.connection.travel_min ?? 99_999)
    || a.connection.departure_time.localeCompare(b.connection.departure_time));
  return all[0] ?? null;
}

async function insertBusSuggestions(
  tripId: string,
  target: TripBusTarget,
  outbound: readonly BusSuggestion[],
  inbound: readonly BusSuggestion[],
): Promise<{ added: number; timetables: Timetable[]; departures: TimetableDeparture[] }> {
  const timetables: Timetable[] = [];
  const departures: TimetableDeparture[] = [];
  let added = 0;

  async function insertFor(direction: 'outbound' | 'inbound', suggestions: readonly BusSuggestion[]): Promise<void> {
    if (suggestions.length === 0) return;
    const tt = await ensureTimetable(
      tripId,
      'bus',
      direction === 'outbound' ? '接続バス（行き候補）' : '接続バス（帰り候補）',
      direction === 'outbound' ? `${NASUSHIOBARA_STATION.name}駅周辺` : `${target.name}周辺`,
      direction === 'outbound' ? `${target.name}周辺` : `${NASUSHIOBARA_STATION.name}駅周辺`,
      `GTFSから${TOHOKU_SHINKANSEN_LINE}に接続するバスを検索。`,
    );
    timetables.push(tt);
    const current = (await sql`
      SELECT depart_time, arrive_time, train_name, note FROM timetable_departures WHERE timetable_id=${tt.id}`) as Array<{
        depart_time: string | null; arrive_time: string | null; train_name: string | null; note: string | null;
      }>;
    const seen = new Set(current.map((d) => `${d.depart_time ?? ''}|${d.arrive_time ?? ''}|${d.train_name ?? ''}|${d.note ?? ''}`));
    const [cnt] = (await sql`
      SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${tt.id}`) as { n: number }[];
    let order = cnt?.n ?? 0;
    for (const s of suggestions) {
      const dep = shortTime(s.connection.departure_time);
      const arr = shortTime(s.connection.arrival_time);
      const name = routeLabel(s.connection);
      const note = busNote(s);
      const key = `${dep ?? ''}|${arr ?? ''}|${name}|${note}`;
      if (seen.has(key)) continue;
      await sql`INSERT INTO timetable_departures
        (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
        VALUES (${newId()}, ${tt.id}, ${dep}, ${arr}, ${name}, ${null}, ${null}, ${note}, ${order++})`;
      added++;
      seen.add(key);
    }
    const rows = (await sql`
      SELECT * FROM timetable_departures WHERE timetable_id=${tt.id}
      ORDER BY order_index, depart_time`) as TimetableDeparture[];
    departures.push(...rows);
  }

  await insertFor('outbound', outbound);
  await insertFor('inbound', inbound);

  return { added, timetables, departures };
}

// 利用可能な取得プロバイダを返す。crawl-llm は常時、ekispert は契約キー設定時のみ。
app.get('/api/transit/config', (c) => {
  const ekispertEnabled = Boolean(config.transit.ekispertKey);
  const providers = PROVIDER_KINDS.filter((k) => k !== 'ekispert' || ekispertEnabled);
  return c.json({ providers, default: defaultProviderKind(config), ekispertEnabled });
});

/** プロバイダ例外 → HTTP。未配線=501 / 入力不足=400 / 取得失敗=502。想定外は握り潰さず再 throw。 */
function providerErrorResponse(c: Context, e: unknown): Response {
  if (e instanceof ProviderUnavailableError) return c.json({ error: e.message, hint: e.hint }, 501);
  if (e instanceof ProviderInputError) return c.json({ error: e.message, hint: e.hint }, 400);
  if (e instanceof ProviderFetchError) return c.json({ error: e.message }, 502);
  throw e;
}

// ── 時刻表ボード ──────────────────────────────────────────────────────────
app.get('/api/trips/:id/timetables', async (c) => {
  const rows = (await sql`
    SELECT * FROM timetables WHERE trip_id=${c.req.param('id')} ORDER BY created_at`) as Timetable[];
  return c.json(rows);
});

app.post('/api/trips/:id/timetables', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<Timetable>;
  const kind: TimetableKind = VALID_KINDS.includes(b.kind as TimetableKind) ? (b.kind as TimetableKind) : 'train';
  const id = newId();
  await sql`INSERT INTO timetables (id, trip_id, kind, line_name, from_station, to_station, notes)
    VALUES (${id}, ${trip_id}, ${kind}, ${b.line_name ?? null}, ${b.from_station ?? null}, ${b.to_station ?? null}, ${b.notes ?? null})`;
  const [t] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  return c.json(t);
});

app.post('/api/trips/:id/timetables/tohoku-shinkansen-seed', async (c) => {
  const tripId = c.req.param('id');
  const r = await ensureTohokuShinkansen(tripId);
  return c.json({ ...r, source_url: TOHOKU_SHINKANSEN_SOURCE });
});

app.post('/api/trips/:id/timetables/tohoku-shinkansen-bus-suggestions', async (c) => {
  const tripId = c.req.param('id');
  const [trip] = (await sql`
    SELECT start_date, end_date FROM trips WHERE id=${tripId}`) as TripDateRow[];
  if (!trip) return c.json({ error: 'trip not found' }, 404);

  const target = await tripBusTarget(tripId);
  if (!target) {
    return c.json({ error: 'バス候補を検索するには、旅の拠点または場所に座標を設定してください' }, 422);
  }

  await ensureTohokuShinkansen(tripId);

  const outboundDate = toGtfsDate(trip.start_date);
  const inboundDate = toGtfsDate(trip.end_date ?? trip.start_date);
  const stationStops = await nearbyStops(NASUSHIOBARA_STATION.lat, NASUSHIOBARA_STATION.lng, 900, 24);
  const targetStops = await nearbyStops(target.lat, target.lng, 1200, 24);
  if (stationStops.length === 0) {
    return c.json({ error: '那須塩原駅周辺のGTFS停留所が見つかりません。バスGTFSを取り込んでください' }, 422);
  }
  if (targetStops.length === 0) {
    return c.json({ error: `${target.name}周辺のGTFS停留所が見つかりません。拠点座標またはGTFSを確認してください` }, 422);
  }
  const commonFeeds = [...byFeed(stationStops).keys()].filter((id) => byFeed(targetStops).has(id));
  if (commonFeeds.length === 0) {
    return c.json({ error: '那須塩原駅周辺と拠点周辺を同じGTFSフィード内で結べませんでした' }, 422);
  }

  const outbound: BusSuggestion[] = [];
  for (const train of TOHOKU_SHINKANSEN_NASUNO_DOWN) {
    const hit = await bestConnectionsForTrain('outbound', train, outboundDate, stationStops, targetStops);
    if (hit) outbound.push(hit);
  }

  const inbound: BusSuggestion[] = [];
  for (const train of TOHOKU_SHINKANSEN_NASUNO_UP) {
    const hit = await bestConnectionsForTrain('inbound', train, inboundDate, stationStops, targetStops);
    if (hit) inbound.push(hit);
  }

  const saved = await insertBusSuggestions(tripId, target, outbound, inbound);
  return c.json({
    target,
    station: NASUSHIOBARA_STATION.name,
    outbound_date: outboundDate,
    inbound_date: inboundDate,
    added: saved.added,
    timetables: saved.timetables,
    departures: saved.departures,
    outbound,
    inbound,
  });
});

app.delete('/api/timetables/:id', async (c) => {
  await sql`DELETE FROM timetables WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// ── 便 (手入力) ──────────────────────────────────────────────────────────
app.get('/api/timetables/:id/departures', async (c) => {
  const rows = (await sql`
    SELECT * FROM timetable_departures WHERE timetable_id=${c.req.param('id')}
    ORDER BY order_index, depart_time`) as TimetableDeparture[];
  return c.json(rows);
});

app.post('/api/timetables/:id/departures', async (c) => {
  const timetable_id = c.req.param('id');
  const [tt] = (await sql`SELECT id FROM timetables WHERE id=${timetable_id}`) as { id: string }[];
  if (!tt) return c.json({ error: 'timetable not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Partial<TimetableDeparture>;
  const cnt = (await sql`SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${timetable_id}`) as { n: number }[];
  const order_index = typeof b.order_index === 'number' ? b.order_index : (cnt[0]?.n ?? 0);
  const id = newId();
  await sql`INSERT INTO timetable_departures
    (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
    VALUES (${id}, ${timetable_id}, ${b.depart_time ?? null}, ${b.arrive_time ?? null}, ${b.train_name ?? null},
            ${b.platform ?? null}, ${b.fare_text ?? null}, ${b.note ?? null}, ${order_index})`;
  const [d] = (await sql`SELECT * FROM timetable_departures WHERE id=${id}`) as TimetableDeparture[];
  return c.json(d);
});

app.delete('/api/departures/:id', async (c) => {
  await sql`DELETE FROM timetable_departures WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// ── 便の自動取得 (provider: 既定 crawl-llm / ekispert) ─────────────────────
// body: { provider?: 'crawl-llm'|'ekispert', url?: string, date?: 'YYYY-MM-DD' }
//   crawl-llm: url のページをクロール→LLM 抽出。ekispert: timetable の from/to 駅で経路探索。
app.post('/api/timetables/:id/fetch', async (c) => {
  const id = c.req.param('id');
  const [tt] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  if (!tt) return c.json({ error: 'timetable not found' }, 404);

  const b = (await c.req.json().catch(() => ({}))) as { provider?: string; url?: string; date?: string };

  try {
    const provider = resolveProvider(b.provider, config);
    if (!provider.supportsDepartures) {
      return c.json({ error: `${provider.kind} は時刻表の自動取得に未対応です` }, 501);
    }
    const extracted = await provider.fetchDepartures({
      kind: tt.kind,
      line_name: tt.line_name,
      from_station: tt.from_station,
      to_station: tt.to_station,
      url: b.url ?? null,
      date: b.date ?? null,
    });
    if (extracted.length === 0) {
      return c.json({ error: 'ページ/応答から便を抽出できませんでした (手入力で追加してください)' }, 422);
    }

    // 既存便の後ろに連番で追加する (手入力分を上書きしない)。
    const [cnt] = (await sql`SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${id}`) as { n: number }[];
    let order = cnt?.n ?? 0;
    for (const d of extracted) {
      await sql`INSERT INTO timetable_departures
        (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
        VALUES (${newId()}, ${id}, ${d.depart_time}, ${d.arrive_time}, ${d.train_name},
                ${d.platform}, ${d.fare_text}, ${d.note}, ${order++})`;
    }
    const rows = (await sql`
      SELECT * FROM timetable_departures WHERE timetable_id=${id}
      ORDER BY order_index, depart_time`) as TimetableDeparture[];
    return c.json({ provider: provider.kind, added: extracted.length, departures: rows });
  } catch (e) {
    return providerErrorResponse(c, e);
  }
});

// ── 運行情報 (手入力 + refresh スタブ) ─────────────────────────────────────
app.get('/api/trips/:id/service-alerts', async (c) => {
  const rows = (await sql`
    SELECT * FROM service_alerts WHERE trip_id=${c.req.param('id')} ORDER BY created_at DESC`) as ServiceAlert[];
  return c.json(rows);
});

app.post('/api/trips/:id/service-alerts', async (c) => {
  const trip_id = c.req.param('id');
  const b = pick<ServiceAlert>(await c.req.json().catch(() => ({})), [
    'line_name', 'severity', 'title', 'body', 'source_url',
  ]);
  const id = newId();
  await sql`INSERT INTO service_alerts (id, trip_id, line_name, severity, title, body, source_url, fetched_at)
    VALUES (${id}, ${trip_id}, ${b.line_name ?? null}, ${b.severity ?? 'info'}, ${b.title ?? null},
            ${b.body ?? null}, ${b.source_url ?? null}, ${null})`;
  const [a] = (await sql`SELECT * FROM service_alerts WHERE id=${id}`) as ServiceAlert[];
  return c.json(a);
});

app.delete('/api/service-alerts/:id', async (c) => {
  await sql`DELETE FROM service_alerts WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// body: { provider?: 'crawl-llm'|'ekispert', url?: string, line_name?: string }
//   crawl-llm: url の運行情報ページをクロール→LLM 抽出。ekispert は運行情報未対応 (501)。
app.post('/api/trips/:id/service-alerts/refresh', async (c) => {
  const tripId = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as { provider?: string; url?: string; line_name?: string };

  try {
    const provider = resolveProvider(b.provider, config);
    if (!provider.supportsAlerts) {
      return c.json(
        {
          error: `${provider.kind} は運行情報の自動更新に未対応です`,
          hint: 'crawl-llm (url 指定) を使うか、各社運行情報 API を配線してください。',
        },
        501,
      );
    }
    const alerts = await provider.fetchAlerts({ line_name: b.line_name ?? null, url: b.url ?? null });
    if (alerts.length === 0) {
      return c.json({ error: 'ページ/応答から運行情報を抽出できませんでした (手入力で登録してください)' }, 422);
    }

    const fetchedAt = nowIso();
    for (const a of alerts) {
      await sql`INSERT INTO service_alerts (id, trip_id, line_name, severity, title, body, source_url, fetched_at)
        VALUES (${newId()}, ${tripId}, ${a.line_name}, ${a.severity}, ${a.title}, ${a.body}, ${a.source_url}, ${fetchedAt})`;
    }
    const rows = (await sql`
      SELECT * FROM service_alerts WHERE trip_id=${tripId} ORDER BY created_at DESC`) as ServiceAlert[];
    return c.json({ provider: provider.kind, added: alerts.length, alerts: rows });
  } catch (e) {
    return providerErrorResponse(c, e);
  }
});

export default app;
