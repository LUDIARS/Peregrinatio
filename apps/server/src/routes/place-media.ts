// 場所の代表画像を Web から取得する。
//  優先: place.source_url か place_links の先頭 URL を PoliteFetcher で取得し
//        og:image (無ければ twitter:image) を image_url に。
//  fallback: Places Text Search (name + lat/lng) の photo → resolvePhotoUrl を image_url に。
// Places fallback は API キーが要る。キー空でそこに到達したら 400。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import { PoliteFetcher, decodeEntities } from '@peregrinatio/crawl';
import { searchPlaces, resolvePhotoUrl } from '@peregrinatio/places';
import type { Place, PlaceLink } from '../types.js';

const app = new Hono();

/** HTML から og:image (無ければ twitter:image) の content を抜き、相対URLを絶対化して返す。 */
function extractOgImage(html: string, baseUrl: string): string | null {
  const props = ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  for (const prop of props) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
      'i',
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
      'i',
    );
    const m = re.exec(html) ?? re2.exec(html);
    if (m && m[1]) {
      const raw = decodeEntities(m[1]).trim();
      if (!raw) continue;
      try {
        return new URL(raw, baseUrl).href;
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/** POST /api/places/:id/image-from-web — Web/Places から代表画像を取得して image_url に保存。 */
app.post('/api/places/:id/image-from-web', async (c) => {
  const id = c.req.param('id');
  const [place] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!place) return c.json({ error: 'place not found' }, 404);

  // 1) source_url か place_links の先頭 URL から og:image を試す。
  let pageUrl = (place.source_url || '').trim();
  if (!pageUrl) {
    const [link] = (await sql`
      SELECT * FROM place_links WHERE place_id=${id} ORDER BY created_at LIMIT 1`) as PlaceLink[];
    if (link?.url) pageUrl = link.url.trim();
  }

  let imageUrl: string | null = null;
  if (pageUrl) {
    const fetcher = new PoliteFetcher({
      userAgent: config.crawl.userAgent,
      fetchTimeoutMs: config.crawl.fetchTimeoutMs,
      minIntervalMs: config.crawl.minIntervalMs,
      respectRobots: config.crawl.respectRobots,
    });
    const res = await fetcher.fetch(pageUrl);
    if (res.ok) imageUrl = extractOgImage(res.html, pageUrl);
  }

  // 2) 取れなければ Places photo に fallback (API キー必須)。
  if (!imageUrl) {
    if (!config.googleMaps.apiKey) {
      return c.json(
        { error: 'googleMaps.apiKey 未設定: Web から画像を取得できず、Places fallback も実行できません' },
        400,
      );
    }
    try {
      const results = await searchPlaces(
        {
          q: place.name,
          lat: place.lat ?? undefined,
          lng: place.lng ?? undefined,
        },
        config.googleMaps.apiKey,
      );
      const photoName = results[0]?.photoName;
      if (photoName) imageUrl = await resolvePhotoUrl(photoName, config.googleMaps.apiKey);
    } catch {
      // ベストエフォート: 取得できなければ warning で返す。
    }
  }

  if (!imageUrl) {
    return c.json({ place, warning: '代表画像を取得できませんでした (og:image も Places photo も見つかりません)' });
  }

  await sql`UPDATE places SET image_url=${imageUrl}, updated_at=${nowIso()} WHERE id=${id}`;
  const [updated] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  return c.json(updated);
});

export default app;
