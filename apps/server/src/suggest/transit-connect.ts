// 公共交通の「実際に乗れる便」を引く層。
// プランの移動を平均速度で近似せず、取り込み済み GTFS の時刻表から実便を引く。
// 探索そのものは既存の searchRouteGraph (直通 + 乗換 1 回) を使い、ここでは
// プラン構築が必要とする形 (最速で着く便 / 最終で戻れる便) に整えてキャッシュする。

import { searchRouteGraph } from '../lib/gtfs-query.js';
import { gtfsTimeToMinutes, minutesToSearchTime } from './plan-time.js';
import type { GeoPoint } from './plan-travel.js';
import type { PlanTransitLeg } from './types.js';

/** 拠点・目的地と停留所の間で許容する徒歩距離。これを超えると「歩いて行けない」。 */
export const DEFAULT_WALK_RADIUS_M = 1_200;

/** 便の検索を丸める粒度 (分)。同じ時間帯の問い合わせを 1 回にまとめる。 */
const TIME_BUCKET_MIN = 10;

export interface TransitConnection {
  /** 0 時からの分。 */
  depart_min: number;
  arrive_min: number;
  leg: PlanTransitLeg;
}

export interface TransitConnector {
  /** earliestDepartMin 以降に出て、最も早く着く便。無ければ null。 */
  depart(from: GeoPoint, to: GeoPoint, earliestDepartMin: number): Promise<TransitConnection | null>;
  /** latestArriveMin までに着く便のうち、最も遅く出るもの (= 最終便)。無ければ null。 */
  arriveBy(from: GeoPoint, to: GeoPoint, latestArriveMin: number): Promise<TransitConnection | null>;
  /** 問い合わせ回数 (性能の見張り用)。 */
  queryCount(): number;
}

function pointKey(p: GeoPoint): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

function bucket(minutes: number): number {
  return Math.floor(minutes / TIME_BUCKET_MIN) * TIME_BUCKET_MIN;
}

export interface TransitConnectorOptions {
  /** 'YYYYMMDD'。運行日の判定に使う。 */
  date: string;
  walkRadiusM?: number;
}

/**
 * 便検索器を作る。同じ (区間, 時間帯, 基準) は 1 回しか問い合わせない —
 * 日割り探索は同じ区間を何度も評価するため、素直に呼ぶと問い合わせが爆発する。
 */
export function createTransitConnector(options: TransitConnectorOptions): TransitConnector {
  const radiusM = options.walkRadiusM ?? DEFAULT_WALK_RADIUS_M;
  const cache = new Map<string, TransitConnection | null>();
  let queries = 0;

  async function search(
    from: GeoPoint,
    to: GeoPoint,
    targetMin: number,
    basis: 'departure' | 'arrival',
  ): Promise<TransitConnection | null> {
    const key = `${basis}|${pointKey(from)}|${pointKey(to)}|${bucket(targetMin)}`;
    if (cache.has(key)) return cache.get(key) ?? null;

    queries += 1;
    const result = await searchRouteGraph({
      from, to,
      date: options.date,
      time: minutesToSearchTime(targetMin),
      basis,
      radiusM,
      limit: 8,
    });

    const usable = result.options
      .map((option) => {
        const depart = gtfsTimeToMinutes(option.departure_time);
        const arrive = gtfsTimeToMinutes(option.arrival_time);
        if (depart == null || arrive == null) return null;
        return {
          depart_min: depart,
          arrive_min: arrive,
          leg: {
            summary: option.summary,
            departure_time: option.departure_time,
            arrival_time: option.arrival_time,
            transfer_count: option.transfer_count,
            walk_from_m: option.walk_from_m,
            walk_to_m: option.walk_to_m,
          },
        } satisfies TransitConnection;
      })
      .filter((c): c is TransitConnection => c !== null)
      .filter((c) => (basis === 'departure' ? c.depart_min >= targetMin : c.arrive_min <= targetMin));

    // 出発基準なら「最も早く着く」、到着基準なら「最も遅く出る」を採る。
    usable.sort((a, b) => (basis === 'departure'
      ? a.arrive_min - b.arrive_min || a.leg.transfer_count - b.leg.transfer_count
      : b.depart_min - a.depart_min || a.leg.transfer_count - b.leg.transfer_count));

    const best = usable[0] ?? null;
    cache.set(key, best);
    return best;
  }

  return {
    queryCount: () => queries,
    depart: (from, to, earliestDepartMin) => search(from, to, earliestDepartMin, 'departure'),
    arriveBy: (from, to, latestArriveMin) => search(from, to, latestArriveMin, 'arrival'),
  };
}
