// 🚕 タクシー初乗り圏の判定 (純関数)。
// 起点 (拠点 / 最寄り駅) のどちらかから、道のり (直線 × 車の迂回係数) が初乗り距離に収まれば印を付ける。
// 両方収まるときは近いほうを根拠にする。
// @implements SPEC-ACCESS-TAXI

import { haversineMeters } from '../lib/segment-mode.js';
import { DRIVING_DETOUR, type GeoPoint } from '../suggest/plan-travel.js';
import type { TaxiFirstFareMark } from './types.js';

export interface TaxiOrigin {
  kind: 'base' | 'station';
  name: string;
  point: GeoPoint;
}

export function judgeTaxiFirstFare(
  candidate: GeoPoint,
  origins: readonly TaxiOrigin[],
  thresholdM: number,
): TaxiFirstFareMark | null {
  let best: TaxiFirstFareMark | null = null;
  for (const o of origins) {
    const road = Math.round(haversineMeters(o.point, candidate) * DRIVING_DETOUR);
    if (road > thresholdM) continue;
    if (!best || road < best.distance_m) {
      best = { origin_kind: o.kind, origin_name: o.name, distance_m: road, threshold_m: thresholdM };
    }
  }
  return best;
}
