// 住所 → 緯度経度。geocode_cache でキャッシュし失敗も記録して再試行を抑える (Tirocinium 踏襲)。
// API キー未設定は silent fallback せず例外にする ([[feedback_no_silent_fallback]])。呼び出し側が
// 二次機能 (クロール/解析のついで) なら try/catch して結果に warning を載せて握り潰さず surface する。
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { nowIso } from './ids.js';
import { geocode as geocodeApi } from '@peregrinatio/places';

export class GeocodeNotConfiguredError extends Error {}

export async function geocodeCached(address: string): Promise<{ lat: number; lng: number } | null> {
  const loc = (address ?? '').trim();
  if (!loc) return null;

  const hit = (await sql`SELECT lat, lng, ok FROM geocode_cache WHERE location=${loc}`) as {
    lat: number | null;
    lng: number | null;
    ok: number;
  }[];
  if (hit.length > 0) {
    const h = hit[0]!;
    return h.ok && h.lat != null && h.lng != null ? { lat: h.lat, lng: h.lng } : null;
  }

  if (!config.googleMaps.apiKey) {
    throw new GeocodeNotConfiguredError(
      'googleMaps.apiKey 未設定: Geocoding を実行できません (data/secrets.local.json を設定してください)',
    );
  }

  const res = await geocodeApi(loc, config.googleMaps.apiKey);
  await sql`INSERT INTO geocode_cache (location, lat, lng, ok, geocoded_at)
    VALUES (${loc}, ${res?.lat ?? null}, ${res?.lng ?? null}, ${res ? 1 : 0}, ${nowIso()})
    ON CONFLICT(location) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, ok=excluded.ok, geocoded_at=excluded.geocoded_at`;
  return res;
}
