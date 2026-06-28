// 画面遷移 (タブ切替) のたびに getTrip が走って「読み込み中…」がちらつくのを防ぐため、
// 取得済みの TripDetail をモジュールレベルでキャッシュする (stale-while-revalidate)。
// 表示は即キャッシュ → 裏で最新取得 → 差し替え、という流れで使う。

import { api } from '../api.js';
import type { TripDetail } from '../types.js';

const tripCache = new Map<string, TripDetail>();

/** キャッシュ済みの旅 (無ければ undefined)。即時表示に使う。 */
export function getCachedTrip(id: string): TripDetail | undefined {
  return tripCache.get(id);
}

/** 最新を取得しキャッシュへ反映する。 */
export async function fetchTrip(id: string): Promise<TripDetail> {
  const t = await api.getTrip(id);
  tripCache.set(id, t);
  return t;
}

/** 明示的にキャッシュを捨てる (削除後など)。 */
export function invalidateTrip(id: string): void { tripCache.delete(id); }
