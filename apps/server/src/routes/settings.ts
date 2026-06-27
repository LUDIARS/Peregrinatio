// アプリ設定 (自宅) の HTTP API。住所はサーバ側で Geocoding して座標化し保存する。
// キー未設定やジオコーディング失敗は silent fallback せず明示エラー ([[feedback_no_silent_fallback]])。

import { Hono } from 'hono';
import { geocode } from '@peregrinatio/places';
import { config } from '../config.js';
import { clearHome, getHome, setHome } from '../settings/home.js';

const app = new Hono();

app.get('/api/settings/home', async (c) => {
  return c.json(await getHome());
});

app.put('/api/settings/home', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { address?: string };
  const address = (b.address ?? '').trim();
  if (!address) return c.json({ error: '自宅の住所を入力してください' }, 400);
  if (!config.googleMaps.apiKey) {
    return c.json({ error: 'googleMaps.apiKey 未設定: 住所を座標化できません' }, 400);
  }
  const loc = await geocode(address, config.googleMaps.apiKey);
  if (!loc) return c.json({ error: '住所から場所を特定できませんでした (住所を見直してください)' }, 422);
  const home = { address, lat: loc.lat, lng: loc.lng };
  await setHome(home);
  return c.json(home);
});

app.delete('/api/settings/home', async (c) => {
  await clearHome();
  return c.json({ ok: true });
});

export default app;
