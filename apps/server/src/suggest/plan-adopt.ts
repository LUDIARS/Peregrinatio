// プラン案の採用 (唯一の書き込み経路)。
// 提案時点では DB を触らず、ユーザが採用した案だけをここで反映する。
// 採用は上書き: 案に含まれる日の予定と経路を消してから入れ直す。
// 案に含まれない日は触らない。

import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { ItineraryItemKind, TripDay } from '../types.js';
import type { PlanDay, PlanItem } from './types.js';

export interface PlanAdoptResult {
  days: TripDay[];
  /** 作成した予定の件数。 */
  items: number;
  /** 上書きで消した予定の件数。 */
  replaced: number;
}

const KINDS: readonly ItineraryItemKind[] = ['visit', 'move', 'note'];

function validKind(kind: unknown): kind is ItineraryItemKind {
  return typeof kind === 'string' && (KINDS as readonly string[]).includes(kind);
}

/** 予定 1 件に落とすときのメモ。移動は手段と所要を文字で残す (route_legs は採用後に再計算する)。 */
export function noteOf(item: PlanItem): string | null {
  if (item.kind !== 'move') return item.note;
  const minutes = item.duration_sec != null ? Math.round(item.duration_sec / 60) : null;
  const source = item.duration_source === 'routes' ? '実所要' : '概算';
  const parts = [item.label];
  if (minutes != null) parts.push(`約${minutes}分 (${source})`);
  return parts.join(' / ');
}

/**
 * 案を旅に反映する。
 * @param tripId 対象の旅
 * @param days 採用する日 (提案をそのまま、またはユーザが間引いたもの)
 */
export async function adoptPlan(tripId: string, days: PlanDay[]): Promise<PlanAdoptResult> {
  return sql.begin(async (tx) => {
    // この旅に属する場所だけを予定に載せる (他の旅の place_id を混ぜられないようにする)。
    const memberRows = (await tx`
      SELECT place_id FROM trip_places WHERE trip_id=${tripId}`) as Array<{ place_id: string }>;
    const members = new Set(memberRows.map((r) => r.place_id));

    const existingDays = (await tx`
      SELECT * FROM trip_days WHERE trip_id=${tripId} ORDER BY day_index`) as TripDay[];
    const byIndex = new Map(existingDays.map((d) => [d.day_index, d] as const));

    let created = 0;
    let replaced = 0;

    for (const day of days) {
      const found = byIndex.get(day.day_index);
      let row: TripDay;
      if (!found) {
        const id = newId();
        await tx`INSERT INTO trip_days (id, trip_id, day_index, date, title, notes)
          VALUES (${id}, ${tripId}, ${day.day_index}, ${day.date ?? null}, ${day.title}, ${day.note ?? null})`;
        const [inserted] = (await tx`SELECT * FROM trip_days WHERE id=${id}`) as TripDay[];
        if (!inserted) throw new Error('作成した旅程日を読み戻せませんでした');
        row = inserted;
        byIndex.set(day.day_index, row);
      } else {
        row = found;
        await tx`UPDATE trip_days SET date=${day.date ?? row.date}, title=${day.title}, notes=${day.note ?? row.notes}
          WHERE id=${row.id}`;
      }

      const [count] = (await tx`
        SELECT COUNT(*) AS n FROM itinerary_items WHERE day_id=${row.id}`) as Array<{ n: number }>;
      replaced += count?.n ?? 0;

      // 上書き: 既存の予定と、それに紐づく経路を消す。
      await tx`DELETE FROM route_legs WHERE day_id=${row.id}`;
      await tx`DELETE FROM itinerary_items WHERE day_id=${row.id}`;

      let orderIndex = 0;
      for (const item of day.items) {
        if (!validKind(item.kind)) throw new Error('不正な予定種別が採用処理へ渡されました');
        const placeId = item.place_id && members.has(item.place_id) ? item.place_id : null;
        // 場所指定の予定なのに旅の場所でなければ、メモ行として残す (黙って捨てない)。
        const kind: ItineraryItemKind = item.kind === 'visit' && !placeId ? 'note' : item.kind;
        await tx`INSERT INTO itinerary_items (id, day_id, place_id, order_index, planned_time, kind, note, edited_by)
          VALUES (${newId()}, ${row.id}, ${placeId}, ${orderIndex}, ${item.planned_time ?? null},
                  ${kind}, ${noteOf(item) ?? item.label}, ${'プラン提案'})`;
        orderIndex += 1;
        created += 1;
      }
    }

    const after = (await tx`
      SELECT * FROM trip_days WHERE trip_id=${tripId} ORDER BY day_index`) as TripDay[];
    return { days: after, items: created, replaced };
  });
}
