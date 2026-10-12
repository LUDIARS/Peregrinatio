// 乗車駅・降車駅を決める純関数。
//   乗車駅 = 出発地点に最も近い取り込み済みの駅 (50km を超えたら候補外)
//   降車駅 = 同じ路線で拠点に最も近い駅
// 同じ駅が複数路線にある (東京駅など) ときは、拠点側の駅が近い路線を採る。
// @implements SPEC-EXPRESS-SUGGEST

import { haversineMeters } from '../lib/segment-mode.js';
import type { GeoPoint } from '../suggest/plan-travel.js';
import type { ExpressDirection } from './types.js';

export const MAX_BOARD_DISTANCE_M = 50_000;
/** 「同じ駅」とみなす距離の幅。路線ごとに駅座標が少しずれていても同駅として扱う。 */
const SAME_STATION_TOLERANCE_M = 1_000;

export interface LocatedStation {
  line_id: string;
  line_name: string;
  seq: number;
  name: string;
  lat: number;
  lng: number;
}

export interface StationPick {
  line_id: string;
  line_name: string;
  board: LocatedStation & { distance_m: number };
  alight: LocatedStation & { distance_m: number };
  /** 往路 (出発地点 → 拠点) の進行方向。復路は逆。 */
  outbound_direction: ExpressDirection;
}

export type StationPickResult =
  | { ok: true; pick: StationPick }
  | { ok: false; reason: string };

const pointOf = (s: LocatedStation): GeoPoint => ({ lat: s.lat, lng: s.lng });

export function pickStations(
  stations: readonly LocatedStation[],
  origin: GeoPoint,
  destination: GeoPoint,
): StationPickResult {
  if (stations.length === 0) return { ok: false, reason: '座標のある新幹線・特急の駅が取り込まれていません。' };

  const fromOrigin = stations
    .map((s) => ({ ...s, distance_m: Math.round(haversineMeters(origin, pointOf(s))) }))
    .sort((a, b) => a.distance_m - b.distance_m);
  const nearest = fromOrigin[0];
  if (!nearest || nearest.distance_m > MAX_BOARD_DISTANCE_M) {
    return {
      ok: false,
      reason: `出発地点から ${Math.round(MAX_BOARD_DISTANCE_M / 1000)}km 以内に取り込み済みの駅がありません${nearest ? ` (最寄りは ${nearest.name}駅 ${Math.round(nearest.distance_m / 1000)}km)` : ''}。`,
    };
  }

  let best: StationPick | null = null;
  for (const board of fromOrigin.filter((s) => s.distance_m <= nearest.distance_m + SAME_STATION_TOLERANCE_M)) {
    const alight = stations
      .filter((s) => s.line_id === board.line_id && s.seq !== board.seq)
      .map((s) => ({ ...s, distance_m: Math.round(haversineMeters(destination, pointOf(s))) }))
      .sort((a, b) => a.distance_m - b.distance_m)[0];
    if (!alight) continue;
    if (!best || alight.distance_m < best.alight.distance_m) {
      best = {
        line_id: board.line_id,
        line_name: board.line_name,
        board,
        alight,
        outbound_direction: board.seq < alight.seq ? 'down' : 'up',
      };
    }
  }
  if (!best) return { ok: false, reason: `${nearest.name}駅の路線に、拠点側で降りられる別の駅がありません。` };
  // 拠点の最寄り駅が乗車駅と同じなら新幹線・特急で移動する意味がない。
  if (best.alight.distance_m >= haversineMeters(destination, pointOf(best.board))) {
    return { ok: false, reason: `拠点は乗車駅 (${best.board.name}) のほうが近く、新幹線・特急で移動する区間がありません。` };
  }
  return { ok: true, pick: best };
}
