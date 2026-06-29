// 区間 (place→place) ごとの移動手段サジェスト (純関数・IO なし)。
// 「距離」と「最初に使う移動手段 (primary)」から各区間の手段を決める:
//   - 500m 以内は徒歩
//   - それ以上は primary に従う: 車→車 / 自転車→自転車 / それ以外(徒歩/公共交通)→公共交通
// (= すべてが徒歩や車にならないよう、区間ごとに手段を変える)

import type { RouteMode } from '../types.js';

/** 短距離=徒歩サジェストの閾値 (直線距離 m)。 */
export const SHORT_WALK_THRESHOLD_M = 500;

/** 2 点間の直線距離 (m)。ハバーサイン。 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 区間の移動手段をサジェストする。
 * @param distanceM 区間の距離 (直線 m)
 * @param primary その日の最初の移動手段 (ユーザ選択)
 */
export function suggestSegmentMode(distanceM: number, primary: RouteMode): RouteMode {
  if (distanceM <= SHORT_WALK_THRESHOLD_M) return 'walking';
  if (primary === 'driving') return 'driving';
  if (primary === 'bicycling') return 'bicycling';
  // 最初が車以外 (徒歩/公共交通) は、長距離区間を公共交通でサジェストする。
  return 'transit';
}
