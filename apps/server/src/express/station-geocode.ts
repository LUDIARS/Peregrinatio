// 取り込みプレビューの駅に座標を付ける。駅名 + 「駅」で Geocoding し、失敗は null のまま warnings に出す
// (画面で手修正できる)。Geocoding キー未設定も黙って飛ばさず、その旨を 1 度だけ warnings に残す。
// @implements SPEC-EXPRESS-IMPORT

import { geocodeCached, GeocodeNotConfiguredError } from '../lib/geocode.js';
import type { ExpressImportStation } from './types.js';

export type StationGeocoder = (query: string) => Promise<{ lat: number; lng: number } | null>;

/** 座標の無い駅だけを引く。入力配列は変更せず新しい配列を返す。 */
export async function geocodeStations(
  stations: readonly ExpressImportStation[],
  geocoder: StationGeocoder = geocodeCached,
): Promise<{ stations: ExpressImportStation[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: ExpressImportStation[] = [];
  let disabled = false;
  for (const s of stations) {
    if (disabled || (s.lat != null && s.lng != null)) { out.push({ ...s }); continue; }
    try {
      const hit = await geocoder(`${s.name}駅`);
      if (hit) out.push({ ...s, lat: hit.lat, lng: hit.lng });
      else {
        warnings.push(`${s.name}駅の座標を特定できませんでした。保存前に手で入力してください。`);
        out.push({ ...s });
      }
    } catch (e) {
      if (!(e instanceof GeocodeNotConfiguredError)) throw e;
      disabled = true;
      warnings.push('googleMaps.apiKey 未設定のため駅の座標を引けませんでした。便の提案には駅座標が必要です (手で入力してください)。');
      out.push({ ...s });
    }
  }
  return { stations: out, warnings };
}
