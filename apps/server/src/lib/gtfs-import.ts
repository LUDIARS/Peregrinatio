// GTFS / GTFS-JP の zip を取得して Pe の SQLite に一括取込する。
// fetch→unzip(自前)→CSV パース→フィード単位でバッチ INSERT。再取込は同フィードを入れ替える。
// 大きすぎる zip は OOM 回避のため拒否する (silent fallback せず明示エラー)。

import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { unzip } from './unzip.js';
import { parseCsv } from './csv.js';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:55838aab */
import augurContract_34c95456 from './contracts/download.contract.js'; /* augur-inject:contract-predicate:c24929cf */

const MAX_ZIP_BYTES = 80 * 1024 * 1024; // 80MB 上限 (典型的なバス事業者フィードは十分収まる)

function zipTooLarge(bytes: number): Error {
  return new Error(`GTFS zip が大きすぎます (${Math.round(bytes / 1024 / 1024)}MB > 80MB 上限)`);
}

/** 申告サイズと実受信量の双方を制限し、本文全体を無制限に確保しない。 */
export async function readZipResponse(res: Response): Promise<Buffer> {
  const contentLength = Number(res.headers.get('content-length'));
  if (contentLength > MAX_ZIP_BYTES) {
    try { await res.body?.cancel(); }
    catch { /* キャンセル失敗で既存のサイズ超過エラーを置き換えない (best-effort)。 */ }
    throw zipTooLarge(contentLength);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_ZIP_BYTES) throw zipTooLarge(bytes);
      // 所有権を確保し、受信側によるバッファ再利用でも内容が変わらないようにする。
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    try {
      if (!complete) {
        try { await reader.cancel(); }
        catch { /* 切断済みストリームの後始末は best-effort。元の読取/超過エラーを保つ。 */ }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
// @ts-expect-error augur-inject
readZipResponse = contract(readZipResponse, { ...augurContract_34c95456, contractId: 'C-2', mode: 'observe', sample: 1, where: 'apps/server/src/lib/gtfs-import.ts:17', rule: 'contract-wrap', id: '34c95456' }); /* augur-inject:contract-wrap:34c95456 */

export interface GtfsImportResult {
  id: string;
  name: string;
  stop_count: number;
  trip_count: number;
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v: string | undefined): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}
function str(v: string | undefined): string | null {
  return v != null && v.trim() !== '' ? v.trim() : null;
}

/** ファイル名はサブフォルダ付きのこともあるので basename で引く。 */
function pick(files: Map<string, Buffer>, base: string): Record<string, string>[] {
  for (const [name, buf] of files) {
    if (name === base || name.endsWith(`/${base}`)) return parseCsv(buf.toString('utf8'));
  }
  return [];
}

/** rows を chunk ごとの多値 INSERT で投入する (params 上限回避のため列数で chunk を決める)。 */
async function batchInsert(table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const cols = columns.length;
  const perChunk = Math.max(1, Math.floor(900 / cols)); // SQLite の変数上限に余裕を持たせる
  const colList = columns.join(', ');
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const params: unknown[] = [];
    for (const r of chunk) params.push(...r);
    await sql.unsafe(`INSERT INTO ${table} (${colList}) VALUES ${placeholders}`, params);
  }
}

/**
 * GTFS zip を URL から取得して取り込む。
 * @param url GTFS zip の URL
 * @param name 表示名 (空なら agency.txt の agency_name → URL から推定)
 * @throws 取得失敗 / zip でない / サイズ超過
 */
export async function importGtfsFromUrl(url: string, name?: string): Promise<GtfsImportResult> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GTFS の取得に失敗しました (HTTP ${res.status})`);
  const buf = await readZipResponse(res);

  let files: Map<string, Buffer>;
  try {
    files = unzip(buf);
  } catch (e) {
    throw new Error(`GTFS zip を展開できませんでした: ${e instanceof Error ? e.message : String(e)}`);
  }

  const stops = pick(files, 'stops.txt');
  const routes = pick(files, 'routes.txt');
  const trips = pick(files, 'trips.txt');
  const stopTimes = pick(files, 'stop_times.txt');
  const calendar = pick(files, 'calendar.txt');
  const calendarDates = pick(files, 'calendar_dates.txt');
  const agency = pick(files, 'agency.txt');

  if (stops.length === 0 || stopTimes.length === 0) {
    throw new Error('GTFS として認識できません (stops.txt / stop_times.txt が空)');
  }

  const feedId = newId();
  const feedName = str(name) ?? str(agency[0]?.['agency_name']) ?? new URL(url).hostname;
  const now = nowIso();

  await sql.begin(async () => {
    await sql`INSERT INTO gtfs_feeds (id, name, source_url, imported_at, stop_count, trip_count)
      VALUES (${feedId}, ${feedName}, ${url}, ${now}, ${stops.length}, ${trips.length})`;

    await batchInsert('gtfs_stops', ['feed_id', 'stop_id', 'stop_name', 'lat', 'lng'],
      stops.map((s) => [feedId, s['stop_id'] ?? '', str(s['stop_name']), num(s['stop_lat']), num(s['stop_lon'])]));

    await batchInsert('gtfs_routes', ['feed_id', 'route_id', 'short_name', 'long_name', 'route_type'],
      routes.map((r) => [feedId, r['route_id'] ?? '', str(r['route_short_name']), str(r['route_long_name']), int(r['route_type'])]));

    await batchInsert('gtfs_trips', ['feed_id', 'trip_id', 'route_id', 'service_id', 'headsign', 'direction_id'],
      trips.map((t) => [feedId, t['trip_id'] ?? '', str(t['route_id']), str(t['service_id']), str(t['trip_headsign']), int(t['direction_id'])]));

    await batchInsert('gtfs_stop_times', ['feed_id', 'trip_id', 'stop_id', 'stop_sequence', 'departure_time', 'arrive_time'],
      stopTimes.map((st) => [feedId, st['trip_id'] ?? '', st['stop_id'] ?? '', int(st['stop_sequence']), str(st['departure_time']), str(st['arrival_time'])]));

    await batchInsert('gtfs_calendar', ['feed_id', 'service_id', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'start_date', 'end_date'],
      calendar.map((c) => [feedId, c['service_id'] ?? '', int(c['monday']), int(c['tuesday']), int(c['wednesday']), int(c['thursday']), int(c['friday']), int(c['saturday']), int(c['sunday']), str(c['start_date']), str(c['end_date'])]));

    await batchInsert('gtfs_calendar_dates', ['feed_id', 'service_id', 'date', 'exception_type'],
      calendarDates.map((d) => [feedId, d['service_id'] ?? '', d['date'] ?? '', int(d['exception_type'])]));
  });

  return { id: feedId, name: feedName, stop_count: stops.length, trip_count: trips.length };
}
