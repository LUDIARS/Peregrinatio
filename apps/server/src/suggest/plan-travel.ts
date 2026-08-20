// 区間の移動見積り。プランは「移動が成立するか」で日割りが決まるため、
// ここが交通機関ベースの土台になる。
//
// 2 系統:
//   routes   … Routes API の実所要 (API キーあり + use_routes_api)
//   estimate … 直線距離 + 手段別の実効速度からの概算 (キー不要・決定的)
// 概算でも「概算である」ことを duration_source で必ず明示する (silent fallback しない)。

import { computeRoute } from '@peregrinatio/routing';
import { haversineMeters, suggestSegmentMode } from '../lib/segment-mode.js';
import type { RouteMode } from '../types.js';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface TravelEstimate {
  mode: RouteMode;
  duration_sec: number;
  distance_m: number;
  source: 'routes' | 'estimate';
}

/** 手段ごとの実効速度 (m/s)・迂回係数・固定オーバーヘッド (秒)。 */
const TRAVEL_MODEL: Record<RouteMode, { speedMps: number; detour: number; overheadSec: number }> = {
  // 徒歩 4.5km/h。信号待ちを迂回係数に含める。
  walking: { speedMps: 1.25, detour: 1.3, overheadSec: 0 },
  // 自転車 14km/h。駐輪の手間を少し見る。
  bicycling: { speedMps: 3.9, detour: 1.3, overheadSec: 180 },
  // 車 40km/h (市街地想定)。駐車の出し入れを固定で見る。
  driving: { speedMps: 11.1, detour: 1.35, overheadSec: 600 },
  // 公共交通 30km/h (待ち・乗換で実効が落ちる)。待ち時間を固定で見る。
  transit: { speedMps: 8.3, detour: 1.4, overheadSec: 720 },
};

/** 直線距離と手段から所要を概算する (純関数)。 */
export function estimateTravel(from: GeoPoint, to: GeoPoint, mode: RouteMode): TravelEstimate {
  const straight = haversineMeters(from, to);
  const model = TRAVEL_MODEL[mode];
  const distance = Math.round(straight * model.detour);
  const duration = Math.round(distance / model.speedMps) + (straight > 0 ? model.overheadSec : 0);
  return { mode, duration_sec: duration, distance_m: distance, source: 'estimate' };
}

export interface TravelEstimatorOptions {
  /** ユーザが選んだ主たる交通手段。短距離は区間ごとに徒歩へ落ちる。 */
  primaryMode: RouteMode;
  useRoutesApi: boolean;
  apiKey: string;
}

export interface TravelEstimator {
  estimate(from: GeoPoint, to: GeoPoint): Promise<TravelEstimate>;
  /** Routes API の失敗など、概算に落ちた理由。 */
  warnings(): string[];
}

function cacheKey(from: GeoPoint, to: GeoPoint, mode: RouteMode): string {
  const r = (v: number) => v.toFixed(5);
  return `${mode}|${r(from.lat)},${r(from.lng)}|${r(to.lat)},${r(to.lng)}`;
}

/**
 * 区間見積り器を作る。同じ区間は 1 回だけ問い合わせる (日割り探索で同じ区間を何度も評価するため)。
 * Routes API が落ちたら概算へ切り替えるが、理由を warnings に残す。
 */
export function createTravelEstimator(options: TravelEstimatorOptions): TravelEstimator {
  const cache = new Map<string, TravelEstimate>();
  const warned = new Set<string>();
  let routesDisabled = !options.useRoutesApi || !options.apiKey;

  return {
    warnings: () => [...warned],
    async estimate(from, to) {
      const straight = haversineMeters(from, to);
      const mode = suggestSegmentMode(straight, options.primaryMode);
      const key = cacheKey(from, to, mode);
      const hit = cache.get(key);
      if (hit) return hit;

      let result = estimateTravel(from, to, mode);
      if (!routesDisabled) {
        try {
          const route = await computeRoute({ from, to, mode }, options.apiKey);
          if (route.duration_sec != null) {
            result = {
              mode,
              duration_sec: route.duration_sec,
              distance_m: route.distance_m ?? result.distance_m,
              source: 'routes',
            };
          }
        } catch {
          // 1 区間の失敗で全体を止めない。以降は概算に統一して、理由を 1 度だけ残す。
          // 外部サービス例外には接続先や資格情報が含まれうるため、生メッセージは返さない。
          routesDisabled = true;
          warned.add('Routes API での所要取得に失敗したため、以降は直線距離からの概算で組みました。');
        }
      }
      cache.set(key, result);
      return result;
    },
  };
}
