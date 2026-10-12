// アクセス印の外部問い合わせ結果のキャッシュ (place_access_cache)。
// 同じ場所で何度も Places API を呼ばないために置く。TTL を過ぎた値は「無い」扱いにして取り直す。
// @implements SPEC-ACCESS-BUS

import { sql } from '../db/index.js';

export type AccessCacheKind = 'bus_stop_places' | 'station_places' | 'shuttle_llm';

/** Places 由来の結果は 7 日で取り直す。 */
export const PLACES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheClock {
  now(): number;
}
export const systemClock: CacheClock = { now: () => Date.now() };

/**
 * 値を読む。ttlMs を過ぎていれば null。
 * sqlite driver は '{' 始まりの文字列を自動で JSON.parse するので、文字列・オブジェクトの両方を受ける。
 */
export async function readAccessCache<T>(
  cacheKey: string,
  kind: AccessCacheKind,
  ttlMs: number | null,
  clock: CacheClock = systemClock,
): Promise<T | null> {
  const [row] = (await sql`
    SELECT value_json, fetched_at FROM place_access_cache WHERE cache_key=${cacheKey} AND kind=${kind}`) as Array<{
      value_json: unknown; fetched_at: string;
    }>;
  if (!row) return null;
  if (ttlMs != null && clock.now() - Date.parse(row.fetched_at) > ttlMs) return null;
  const v = row.value_json;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

export async function writeAccessCache(
  cacheKey: string,
  kind: AccessCacheKind,
  value: unknown,
  clock: CacheClock = systemClock,
): Promise<void> {
  const fetchedAt = new Date(clock.now()).toISOString();
  await sql`
    INSERT INTO place_access_cache (cache_key, kind, value_json, fetched_at)
    VALUES (${cacheKey}, ${kind}, ${JSON.stringify(value)}, ${fetchedAt})
    ON CONFLICT(cache_key, kind) DO UPDATE SET value_json = excluded.value_json, fetched_at = excluded.fetched_at`;
}
