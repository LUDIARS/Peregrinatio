// 公式情報の自動検索。情報が無い場所について Google Places で施設を引き、空欄
// (位置/住所/カテゴリ/代表画像/公式リンク) を埋める。公式サイトが分かれば要約クロールを
// 取り込みキュー (place_jobs) に積み、背景 worker が要約を反映する。
//   POST /api/trips/:tripId/places/:placeId/auto-search  既存場所の自動検索 (情報補完)
//   POST /api/trips/:tripId/places/from-google           地図 POI (Google place id) から追加+自動検索
// API キー未設定は silent fallback せず明示エラーにする ([[feedback_no_silent_fallback]])。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import { searchPlaces, getPlaceDetails, resolvePhotoUrl, type PlaceDetails } from '@peregrinatio/places';
import type { Place, TripPlace } from '../types.js';

const app = new Hono();

/** 旅メンバーシップ付きの場所 1 件を取得する (レスポンス用)。 */
async function getTripPlace(tripId: string, placeId: string): Promise<TripPlace | undefined> {
  const [tp] = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE p.id = ${placeId} AND tp.trip_id = ${tripId}`) as TripPlace[];
  return tp;
}

/** 公式サイトが分かっていて要約が無ければ、要約クロールを取り込みキューに積む。 */
async function queueSummaryCrawl(tripId: string, placeId: string, websiteUri: string): Promise<void> {
  const now = nowIso();
  await sql`INSERT INTO place_jobs (id, trip_id, place_id, kind, status, source_url, is_new_place, created_at, updated_at)
    VALUES (${newId()}, ${tripId}, ${placeId}, ${'crawl'}, 'pending', ${websiteUri}, 0, ${now}, ${now})`;
}

/** 公式サイトを資料リンク (source='auto') に未登録なら追加する。 */
async function addAutoLink(placeId: string, url: string, title: string): Promise<void> {
  const [exist] = (await sql`
    SELECT id FROM place_links WHERE place_id=${placeId} AND url=${url} LIMIT 1`) as { id: string }[];
  if (!exist) {
    await sql`INSERT INTO place_links (id, place_id, url, title, source, created_at)
      VALUES (${newId()}, ${placeId}, ${url}, ${title}, ${'auto'}, ${nowIso()})`;
  }
}

/**
 * 既存場所の自動検索。Places で施設を引いて空欄を補完し、公式サイトがあれば要約クロールを積む。
 * google_place_id があれば Place Details、無ければ名前で Text Search する。
 * @returns matched=Google で施設が見つかったか / queuedCrawl=要約クロールを積んだか
 */
async function autoSearchPlace(
  tripId: string,
  placeId: string,
): Promise<{ place: Place; matched: boolean; queuedCrawl: boolean }> {
  if (!config.googleMaps.apiKey) {
    throw new Error('googleMaps.apiKey 未設定: 自動検索を実行できません (秘密設定を登録してください)');
  }
  const [place] = (await sql`SELECT * FROM places WHERE id=${placeId}`) as Place[];
  if (!place) throw new Error('place not found');
  if (!place.name || !place.name.trim()) {
    throw new Error('場所の名前がありません (自動検索には名前が必要です)');
  }

  // 詳細の取得元: google_place_id があれば Place Details、無ければ名前で Text Search の先頭。
  let detail: PlaceDetails | null = null;
  if (place.google_place_id) {
    detail = await getPlaceDetails(place.google_place_id, config.googleMaps.apiKey);
  }
  if (!detail) {
    const results = await searchPlaces(
      { q: place.name, lat: place.lat ?? undefined, lng: place.lng ?? undefined },
      config.googleMaps.apiKey,
    );
    const top = results[0];
    if (top) {
      detail = {
        place_id: top.place_id,
        name: top.name,
        address: top.address,
        lat: top.lat,
        lng: top.lng,
        category: top.category ?? null,
        websiteUri: top.websiteUri ?? null,
        photoName: top.photoName ?? null,
      };
    }
  }
  if (!detail) {
    return { place, matched: false, queuedCrawl: false };
  }

  // 空欄のみ補完する (既存の手入力を上書きしない)。
  const address = place.address ?? detail.address;
  const lat = place.lat ?? detail.lat;
  const lng = place.lng ?? detail.lng;
  const category = place.category ?? detail.category;
  const sourceUrl = place.source_url ?? detail.websiteUri;
  const googlePlaceId = place.google_place_id ?? detail.place_id ?? null;
  let imageUrl = place.image_url;
  if (!imageUrl && detail.photoName) {
    imageUrl = await resolvePhotoUrl(detail.photoName, config.googleMaps.apiKey);
  }

  const now = nowIso();
  await sql`UPDATE places SET address=${address}, lat=${lat}, lng=${lng}, category=${category},
    source_url=${sourceUrl}, image_url=${imageUrl}, google_place_id=${googlePlaceId}, updated_at=${now}
    WHERE id=${placeId}`;

  if (detail.websiteUri) {
    await addAutoLink(placeId, detail.websiteUri, detail.name || place.name);
  }

  // 公式サイトがあり要約が無ければ、要約クロールを取り込みキューに積む (背景処理)。
  let queuedCrawl = false;
  if (detail.websiteUri && !place.summary) {
    await queueSummaryCrawl(tripId, placeId, detail.websiteUri);
    queuedCrawl = true;
  }

  const [updated] = (await sql`SELECT * FROM places WHERE id=${placeId}`) as Place[];
  return { place: updated ?? place, matched: true, queuedCrawl };
}

/** POST /api/trips/:tripId/places/:placeId/auto-search — 既存場所の情報を Google で自動補完。 */
app.post('/api/trips/:tripId/places/:placeId/auto-search', async (c) => {
  const tripId = c.req.param('tripId');
  const placeId = c.req.param('placeId');
  try {
    const r = await autoSearchPlace(tripId, placeId);
    const tp = await getTripPlace(tripId, placeId);
    return c.json({ place: tp ?? r.place, matched: r.matched, queuedCrawl: r.queuedCrawl });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '自動検索に失敗しました' }, 502);
  }
});

/**
 * POST /api/trips/:tripId/places/from-google — 地図 POI (Google place id) を旅に追加する。
 * body: { place_id }。Place Details で名前/住所/位置/公式サイト/写真を取得して場所を作成し、
 * 公式サイトがあれば要約クロールを取り込みキューに積む。
 * 同じ Google place id の場所が既にあれば再利用する (重複防止)。
 */
app.post('/api/trips/:tripId/places/from-google', async (c) => {
  const tripId = c.req.param('tripId');
  const b = (await c.req.json().catch(() => ({}))) as { place_id?: string };
  const gpid = (b.place_id ?? '').trim();
  if (!gpid) return c.json({ error: 'place_id required' }, 400);

  try {
    // 既にこの Google place id の場所がライブラリにあれば再利用する (Google 呼び出し不要)。
    const [existing] = (await sql`SELECT * FROM places WHERE google_place_id=${gpid} LIMIT 1`) as Place[];

    let placeId: string;
    let queuedCrawl = false;
    if (existing) {
      placeId = existing.id;
    } else {
      // 新規 POI は Place Details の取得に API キーが要る (silent fallback せず明示エラー)。
      if (!config.googleMaps.apiKey) {
        return c.json({ error: 'googleMaps.apiKey 未設定: 地図からの追加を実行できません' }, 400);
      }
      const detail = await getPlaceDetails(gpid, config.googleMaps.apiKey);
      if (!detail || !detail.name) {
        return c.json({ error: '地図上の地点情報を取得できませんでした (別の地点でお試しください)' }, 422);
      }
      placeId = newId();
      const now = nowIso();
      const imageUrl = detail.photoName
        ? await resolvePhotoUrl(detail.photoName, config.googleMaps.apiKey)
        : null;
      await sql`INSERT INTO places (id, name, address, lat, lng, category, source_url, image_url, status, google_place_id, created_at, updated_at)
        VALUES (${placeId}, ${detail.name}, ${detail.address}, ${detail.lat}, ${detail.lng}, ${detail.category},
                ${detail.websiteUri}, ${imageUrl}, ${'none'}, ${gpid}, ${now}, ${now})`;
      if (detail.websiteUri) {
        await addAutoLink(placeId, detail.websiteUri, detail.name);
        await queueSummaryCrawl(tripId, placeId, detail.websiteUri);
        queuedCrawl = true;
      }
    }

    // 旅に紐付け (既に紐付いていれば無視)。
    await sql`INSERT OR IGNORE INTO trip_places (trip_id, place_id, is_base, added_at)
      VALUES (${tripId}, ${placeId}, ${0}, ${nowIso()})`;

    const tp = await getTripPlace(tripId, placeId);
    return c.json({ place: tp, queuedCrawl });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '地図からの追加に失敗しました' }, 502);
  }
});

export default app;
