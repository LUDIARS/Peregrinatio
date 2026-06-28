// 座標から「住所 (reverse geocode)」と「最寄り駅」を Google API で取得する。
// キー未設定は silent fallback せず null を返し、呼び出し側が扱う ([[feedback_no_silent_fallback]])。

import { searchPlaces } from '@peregrinatio/places';
import { config } from '../config.js';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** 2 点間の直線距離 (km, ハバーサイン)。 */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 座標 → 住所文字列 (reverse geocode)。取得不能は null。 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = config.googleMaps.apiKey;
  if (!key) return null;
  const url = `${GEOCODE_URL}?latlng=${lat},${lng}&language=ja&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string; results?: Array<{ formatted_address?: string }> };
  return data.results?.[0]?.formatted_address ?? null;
}

export interface NearestStation { name: string; lat: number; lng: number; distance_m: number }

/** 座標の最寄り駅を取得する (Places で「駅」を近傍検索→直線距離が最小のもの)。取得不能は null。 */
export async function nearestStation(lat: number, lng: number): Promise<NearestStation | null> {
  const key = config.googleMaps.apiKey;
  if (!key) return null;
  const results = await searchPlaces({ q: '駅', lat, lng, radius: 3000 }, key);
  const withCoords = results.filter((r) => r.lat != null && r.lng != null);
  if (withCoords.length === 0) return null;
  let best = withCoords[0]!;
  let bestKm = Infinity;
  for (const r of withCoords) {
    const km = haversineKm({ lat, lng }, { lat: r.lat as number, lng: r.lng as number });
    if (km < bestKm) { bestKm = km; best = r; }
  }
  return { name: best.name, lat: best.lat as number, lng: best.lng as number, distance_m: Math.round(bestKm * 1000) };
}
