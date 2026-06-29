// Google マップ「経路」へのディープリンク。
// Google Routes/Directions API は日本の公共交通(transit)経路を提供しない (ZERO_RESULTS) ため、
// 乗換などは Google マップ本体 (アプリ/Web) を開いて読む。Maps URLs の dir エンドポイントを使う。
//   https://developers.google.com/maps/documentation/urls/get-started#directions-action

import type { RouteMode } from '../types.js';

const GMAP_TRAVELMODE: Record<RouteMode, string> = {
  driving: 'driving',
  walking: 'walking',
  transit: 'transit',
  bicycling: 'bicycling',
};

/** 2 点間の Google マップ経路 URL (mode に応じた travelmode)。座標は "lat,lng"。 */
export function gmapsDirUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: RouteMode,
): string {
  const origin = `${from.lat},${from.lng}`;
  const destination = `${to.lat},${to.lng}`;
  const travelmode = GMAP_TRAVELMODE[mode] ?? 'transit';
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&travelmode=${travelmode}`
  );
}
