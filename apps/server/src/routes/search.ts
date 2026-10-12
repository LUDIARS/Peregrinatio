// 周辺施設検索 (Google Places Text Search)。結果は未保存候補 (PlaceSearchResult[])。
// ?trip_id= を渡すと、その旅の拠点を起点にしたアクセス印 (access_marks) を各候補に付ける。
// API キー未設定は silent fallback せず 400 で明確にエラーにする ([[feedback_no_silent_fallback]])。
// @implements SPEC-ACCESS-ATTACH
import { Hono } from 'hono';
import { config } from '../config.js';
import { searchPlaces } from '@peregrinatio/places';
import type { PlaceSearchResult } from '../types.js';
import { attachAccessMarks, tripBaseOrigin } from '../access-marks/attach.js';
import { unsavedCandidate } from '../access-marks/candidates.js';

const app = new Hono();

app.get('/api/places/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ error: 'q (検索クエリ) は必須です' }, 400);

  if (!config.googleMaps.apiKey) {
    return c.json(
      { error: 'googleMaps.apiKey 未設定: 周辺施設検索を実行できません (data/secrets.local.json を設定してください)' },
      400,
    );
  }

  const latRaw = c.req.query('lat');
  const lngRaw = c.req.query('lng');
  const radiusRaw = c.req.query('radius');
  const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : undefined;
  const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : undefined;
  const radius = radiusRaw != null && radiusRaw !== '' ? Number(radiusRaw) : undefined;

  const results: PlaceSearchResult[] = await searchPlaces(
    {
      q,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      radius: Number.isFinite(radius) ? radius : undefined,
    },
    config.googleMaps.apiKey,
  );
  const tripId = c.req.query('trip_id');
  if (!tripId) return c.json(results);
  return c.json(await attachAccessMarks(results, unsavedCandidate, { base: await tripBaseOrigin(tripId) }));
});

export default app;
