// アプリ設定 (自宅) の HTTP API。住所はサーバ側で Geocoding して座標化し保存する。
// キー未設定やジオコーディング失敗は silent fallback せず明示エラー ([[feedback_no_silent_fallback]])。

import { Hono } from 'hono';
import { geocode } from '@peregrinatio/places';
import { config } from '../config.js';
import { clearHome, getHome, setHome, type HomeLocation } from '../settings/home.js';
import { nearestStation, reverseGeocode } from '../lib/geo-lookup.js';

const app = new Hono();

app.get('/api/settings/home', async (c) => {
  return c.json(await getHome());
});

/**
 * 自宅を設定する。
 *  - { address }      : 住所をジオコーディングして座標化。
 *  - { lat, lng }     : 現在地などの座標から逆ジオコーディングで住所を補完。
 * いずれも最寄り駅を自動取得して保存する。
 */
app.put('/api/settings/home', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { address?: string; lat?: number; lng?: number };
  if (!config.googleMaps.apiKey) {
    return c.json({ error: 'googleMaps.apiKey 未設定: 住所/座標を扱えません' }, 400);
  }

  let lat: number;
  let lng: number;
  let address: string;

  if (typeof b.lat === 'number' && typeof b.lng === 'number') {
    // 現在地 (座標) から: 逆ジオコーディングで住所を補完 (取れなければ座標を表示)。
    lat = b.lat; lng = b.lng;
    address = (await reverseGeocode(lat, lng)) ?? `現在地 (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  } else {
    address = (b.address ?? '').trim();
    if (!address) return c.json({ error: '自宅の住所、または現在地の座標を指定してください' }, 400);
    const loc = await geocode(address, config.googleMaps.apiKey);
    if (!loc) return c.json({ error: '住所から場所を特定できませんでした (住所を見直してください)' }, 422);
    lat = loc.lat; lng = loc.lng;
  }

  // 最寄り駅を自動取得 (取れなくても自宅自体は保存する)。
  const station = await nearestStation(lat, lng).catch(() => null);
  const home: HomeLocation = {
    address, lat, lng,
    station: station?.name ?? null,
    station_lat: station?.lat ?? null,
    station_lng: station?.lng ?? null,
  };
  await setHome(home);
  return c.json(home);
});

app.delete('/api/settings/home', async (c) => {
  await clearHome();
  return c.json({ ok: true });
});

export default app;
