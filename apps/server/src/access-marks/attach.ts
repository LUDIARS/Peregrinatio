// API の応答 (場所一覧・プランの new_places・検索結果) にアクセス印を付ける入口。
// 候補ごとの判定は judge.ts、外部問い合わせは lookups.ts。ここは「どの候補をどう判定に渡すか」だけを持つ。
// @implements SPEC-ACCESS-ATTACH

import { sql } from '../db/index.js';
import { judgeAccessMarks, type AccessLookups } from './judge.js';
import { createAccessLookups } from './lookups.js';
import { getTaxiFirstFareM } from './settings.js';
import type { TaxiOrigin } from './taxi.js';
import type { AccessCandidate, AccessMarks } from './types.js';

/** Places を並列に叩きすぎないための上限。 */
const CONCURRENCY = 4;

/** 旅の拠点 (座標のある先頭) をタクシーの起点にする。 */
export async function tripBaseOrigin(tripId: string): Promise<TaxiOrigin | null> {
  const [row] = (await sql`
    SELECT p.name, tp.base_name, p.lat, p.lng FROM places p JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id=${tripId} AND tp.is_base=1 AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    ORDER BY tp.added_at LIMIT 1`) as Array<{ name: string; base_name: string | null; lat: number; lng: number }>;
  return row ? { kind: 'base', name: row.base_name ?? row.name, point: { lat: row.lat, lng: row.lng } } : null;
}

/** 保存済みの場所の設備名 (シャトル判定の本文に使う)。 */
export async function facilityNamesOf(placeIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (placeIds.length === 0) return out;
  const rows = (await sql.unsafe(
    `SELECT place_id, name FROM place_facilities WHERE place_id IN (${placeIds.map(() => '?').join(', ')}) ORDER BY order_index`,
    [...placeIds],
  )) as Array<{ place_id: string; name: string }>;
  for (const r of rows) out.set(r.place_id, [...(out.get(r.place_id) ?? []), r.name]);
  return out;
}

export interface AttachOptions {
  base: TaxiOrigin | null;
  lookups?: AccessLookups;
  thresholdM?: number;
}

/**
 * items にアクセス印を付けて返す (元の配列は変えない)。toCandidate が null を返す候補 (座標なし) は
 * 調べられないので access_marks を付けない。
 */
export async function attachAccessMarks<T extends object>(
  items: readonly T[],
  toCandidate: (item: T) => AccessCandidate | null,
  options: AttachOptions,
): Promise<Array<T & { access_marks?: AccessMarks }>> {
  const lookups = options.lookups ?? createAccessLookups();
  const threshold = options.thresholdM ?? (await getTaxiFirstFareM()).value;
  const out: Array<T & { access_marks?: AccessMarks }> = items.map((item) => ({ ...item }));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index] as T;
      const candidate = toCandidate(item);
      if (!candidate) continue;
      const marks = await judgeAccessMarks(candidate, options.base, threshold, lookups);
      (out[index] as T & { access_marks?: AccessMarks }).access_marks = marks;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}
