// transit-fetch (Google マップ乗換のヘッドレス取得→LLM 解析) の結果キャッシュ。
// Puppeteer + LLM は重いので、同じ区間 (from/to 座標) への再取得はまずここを見る。
// キーは座標を丸めた文字列。transit は時刻依存なので TTL で鮮度を判定する。

import { sql } from '../db/index.js';
import { nowIso } from './ids.js';
import type { TransitOption } from './transit-parse.js';

type Coord = { lat: number; lng: number };

interface CacheRow {
  // sqlite-driver は '['/'{' 始まりの TEXT を自動 JSON パースするため、読み出し時は
  // 既に配列になっていることがある (string のままのこともある)。unknown で受けて両対応する。
  options_json: unknown;
  fetched_at: string;
}

/** from/to 座標を 5 桁 (≒約1m) に丸めてキャッシュキーにする。 */
export function transitCacheKey(from: Coord, to: Coord): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(from.lat)},${r(from.lng)}|${r(to.lat)},${r(to.lng)}`;
}

/** 鮮度 (ttlMs) 内のキャッシュがあれば返す。無い/古い/壊れていれば null。 */
export async function getCachedTransit(
  from: Coord,
  to: Coord,
  ttlMs: number,
): Promise<{ options: TransitOption[]; fetchedAt: string } | null> {
  const key = transitCacheKey(from, to);
  const [row] = (await sql`
    SELECT options_json, fetched_at FROM transit_fetch_cache WHERE cache_key = ${key}`) as CacheRow[];
  if (!row) return null;
  const ageMs = Date.now() - Date.parse(row.fetched_at);
  if (!Number.isFinite(ageMs) || ageMs > ttlMs) return null; // 解釈不能も古い扱いで取り直す
  const options = coerceOptions(row.options_json);
  if (!options) return null;
  return { options, fetchedAt: row.fetched_at };
}

/** ドライバが自動パースした配列 / 生 JSON 文字列のどちらでも TransitOption[] にする。 */
function coerceOptions(raw: unknown): TransitOption[] | null {
  if (Array.isArray(raw)) return raw as TransitOption[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TransitOption[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 取得結果をキャッシュに保存 (upsert)。空配列は保存しない (再取得を妨げない)。 */
export async function putCachedTransit(from: Coord, to: Coord, options: TransitOption[]): Promise<void> {
  if (options.length === 0) return;
  const key = transitCacheKey(from, to);
  const now = nowIso();
  await sql`
    INSERT INTO transit_fetch_cache (cache_key, from_lat, from_lng, to_lat, to_lng, options_json, fetched_at)
    VALUES (${key}, ${from.lat}, ${from.lng}, ${to.lat}, ${to.lng}, ${JSON.stringify(options)}, ${now})
    ON CONFLICT(cache_key) DO UPDATE SET
      options_json = excluded.options_json, fetched_at = excluded.fetched_at`;
}
