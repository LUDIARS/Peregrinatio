// 近くのおすすめ自動収集。旅の拠点 (trip_places.is_base=1) を中心に、
// config.recommend.queries の各カテゴリで Places Text Search を回し、先頭 perQuery 件を
// places ライブラリ + trip_places (is_base=0) + place_links(source='recommend') に保存する。
// API キー未設定は silent fallback せず 400 ([[feedback_no_silent_fallback]])。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import { searchPlaces, resolvePhotoUrl, type PlaceSearchResult } from '@peregrinatio/places';
import type { TripPlace } from '../types.js';

const app = new Hono();

/** POST /api/trips/:id/recommend — 拠点周辺のおすすめを自動収集して旅に追加。 */
app.post('/api/trips/:id/recommend', async (c) => {
  const trip_id = c.req.param('id');

  const apiKey = config.googleMaps.apiKey;
  if (!apiKey) {
    return c.json(
      { error: 'googleMaps.apiKey 未設定: おすすめ自動収集を実行できません (秘密設定を登録してください)' },
      400,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as { radius?: number };
  const radius =
    typeof body.radius === 'number' && Number.isFinite(body.radius) ? body.radius : config.recommend.radiusM;

  // 拠点: is_base=1 かつ lat/lng のある先頭。
  const [base] = (await sql`
    SELECT p.*, tp.is_base FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${trip_id} AND tp.is_base = 1 AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    ORDER BY tp.added_at
    LIMIT 1`) as TripPlace[];
  if (!base || base.lat == null || base.lng == null) {
    return c.json({ error: '先に拠点を設定してください (位置情報のある拠点が必要です)' }, 400);
  }

  // 既存の旅の場所名 + バッチ内重複の除去用。
  const existing = (await sql`
    SELECT p.name FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${trip_id}`) as { name: string }[];
  const seen = new Set(existing.map((r) => r.name));

  const added: TripPlace[] = [];

  for (const q of config.recommend.queries) {
    let results: PlaceSearchResult[];
    try {
      results = await searchPlaces({ q, lat: base.lat, lng: base.lng, radius }, apiKey);
    } catch {
      continue; // 1 カテゴリの失敗で全体を止めない (ベストエフォート)。
    }

    const adopted = results.slice(0, config.recommend.perQuery);
    for (const r of adopted) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);

      const imageUrl = r.photoName ? await resolvePhotoUrl(r.photoName, apiKey) : null;
      const now = nowIso();
      const placeId = newId();

      await sql`INSERT INTO places (id, name, address, lat, lng, category, source_url, image_url, status, created_at, updated_at)
        VALUES (${placeId}, ${r.name}, ${r.address ?? null}, ${r.lat ?? null}, ${r.lng ?? null}, ${q},
                ${r.websiteUri ?? null}, ${imageUrl}, ${'none'}, ${now}, ${now})`;

      await sql`INSERT OR IGNORE INTO trip_places (trip_id, place_id, is_base, added_at)
        VALUES (${trip_id}, ${placeId}, ${0}, ${now})`;

      if (r.websiteUri) {
        await sql`INSERT INTO place_links (id, place_id, url, title, source, created_at)
          VALUES (${newId()}, ${placeId}, ${r.websiteUri}, ${r.name}, ${'recommend'}, ${now})`;
      }

      const [tp] = (await sql`
        SELECT p.*, tp.is_base FROM places p
        JOIN trip_places tp ON tp.place_id = p.id
        WHERE p.id = ${placeId} AND tp.trip_id = ${trip_id}`) as TripPlace[];
      if (tp) added.push(tp);
    }
  }

  return c.json({ added });
});

export default app;
