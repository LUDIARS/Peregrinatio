// 荷物提案の採用 (唯一の書き込み経路)。
// 選ばれた候補を trip_check_items(list_type='packing') に入れる。
// 「宿にあるので不要」の削除は、ユーザが明示した行だけを消す。

import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { normalizeTitle } from './packing-merge.js';
import type { TripCheckItem } from '../types.js';

/** 採用する荷物 1 件 (クライアントが提案から選んで返す)。 */
export interface PackingAdoptItem {
  title: string;
  quantity?: number | null;
  category?: string | null;
  reason?: string | null;
}

export interface PackingAdoptResult {
  created: TripCheckItem[];
  /** 既に同名があってスキップした件数。 */
  skipped: number;
  /** 「宿にあるので不要」で消した件数。 */
  removed: number;
}

export async function adoptPacking(
  tripId: string,
  items: PackingAdoptItem[],
  removeItemIds: string[],
): Promise<PackingAdoptResult> {
  return sql.begin(async (tx) => {
    const existing = (await tx`
      SELECT id, title FROM trip_check_items WHERE trip_id=${tripId} AND list_type='packing'`) as Array<{
        id: string; title: string;
      }>;
    const seen = new Set(existing.map((e) => normalizeTitle(e.title)));

    const [count] = (await tx`
      SELECT COUNT(*) AS n FROM trip_check_items WHERE trip_id=${tripId} AND list_type='packing'`) as Array<{ n: number }>;
    let orderIndex = count?.n ?? 0;

    const createdIds: string[] = [];
    let skipped = 0;

    for (const item of items) {
      const title = String(item.title ?? '').trim();
      if (!title) continue;
      const key = normalizeTitle(title);
      if (seen.has(key)) { skipped += 1; continue; }
      seen.add(key);

      const id = newId();
      await tx`INSERT INTO trip_check_items
          (id, trip_id, list_type, title, details, status, quantity, category, due_at, order_index)
        VALUES
          (${id}, ${tripId}, ${'packing'}, ${title}, ${item.reason ?? null}, ${'todo'},
           ${typeof item.quantity === 'number' ? item.quantity : null}, ${item.category ?? null}, ${null}, ${orderIndex})`;
      createdIds.push(id);
      orderIndex += 1;
    }

    let removed = 0;
    for (const id of removeItemIds) {
      const result = (await tx`
        SELECT id FROM trip_check_items WHERE id=${id} AND trip_id=${tripId} AND list_type='packing'`) as Array<{ id: string }>;
      if (result.length === 0) continue;
      await tx`DELETE FROM trip_check_items WHERE id=${id}`;
      removed += 1;
    }

    const created: TripCheckItem[] = [];
    for (const id of createdIds) {
      const [row] = (await tx`SELECT * FROM trip_check_items WHERE id=${id}`) as TripCheckItem[];
      if (!row) throw new Error('作成した持ち物を読み戻せませんでした');
      created.push(row);
    }
    return { created, skipped, removed };
  });
}
