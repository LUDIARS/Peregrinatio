// 施設サマリー (クロール→要約) と 画像解析 (vision) の機能ルータ。
// スパインの CRUD とは別レイヤで、@peregrinatio/crawl・@peregrinatio/llm を束ねる。
//   POST /api/places/:id/crawl    URL → 本文抽出 → LLM 要約 → places 更新 (+geocode)
//   POST /api/images/:id/analyze  画像 → vision 読取 → image_analyses (+geocode で place 補完)

import { Hono } from 'hono';
import { resolve } from 'node:path';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { geocodeCached, GeocodeNotConfiguredError } from '../lib/geocode.js';
import { config, PROJECT_ROOT } from '../config.js';
import { PoliteFetcher, htmlToText, extractPlaceInfo } from '@peregrinatio/crawl';
import { analyzeImage, extractJsonBlock } from '@peregrinatio/llm';
import type { Place, PlaceImage, ImageAnalysis } from '../types.js';

const app = new Hono();

/** place_images.path (URL 文字列 /uploads/...) → 実ファイル絶対パス。Agent B と統一規約。 */
function imageAbsPath(path: string): string {
  return resolve(PROJECT_ROOT, 'apps/server', path.replace(/^\//, ''));
}

// ── 施設サマリー: クロール → 要約 ────────────────────────────────────────
app.post('/api/places/:id/crawl', async (c) => {
  const id = c.req.param('id');
  const [place] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!place) return c.json({ error: 'place not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url || place.source_url || '').trim();
  if (!url) {
    return c.json({ error: 'url が必要です (body.url か place.source_url を設定してください)' }, 400);
  }

  const fetcher = new PoliteFetcher({
    userAgent: config.crawl.userAgent,
    fetchTimeoutMs: config.crawl.fetchTimeoutMs,
    minIntervalMs: config.crawl.minIntervalMs,
    respectRobots: config.crawl.respectRobots,
  });
  const res = await fetcher.fetch(url);
  if (!res.ok) {
    return c.json({ error: `取得に失敗しました (${res.reason}): ${res.message}` }, 502);
  }

  const text = htmlToText(res.html);
  const info = await extractPlaceInfo(text, place.name, config.llm.summaryModel);

  const summary = info.summary;
  const category = info.category ?? place.category;
  const address = info.address ?? place.address;
  const now = nowIso();
  await sql`UPDATE places SET summary=${summary}, category=${category}, address=${address},
    source_url=${url}, updated_at=${now} WHERE id=${id}`;

  // 住所が取れたらジオコーディングして lat/lng を立てる。未設定キーは握り潰さず warning で surface。
  let geocodeWarning: string | undefined;
  if (info.address) {
    try {
      const geo = await geocodeCached(info.address);
      if (geo) {
        await sql`UPDATE places SET lat=${geo.lat}, lng=${geo.lng}, updated_at=${nowIso()} WHERE id=${id}`;
      }
    } catch (err) {
      if (err instanceof GeocodeNotConfiguredError) geocodeWarning = err.message;
      else throw err;
    }
  }

  const [updated] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  return c.json(geocodeWarning ? { place: updated, geocodeWarning } : updated);
});

// ── 画像を解析 (vision) ──────────────────────────────────────────────────
app.post('/api/images/:id/analyze', async (c) => {
  const imageId = c.req.param('id');
  const [image] = (await sql`SELECT * FROM place_images WHERE id=${imageId}`) as PlaceImage[];
  if (!image) return c.json({ error: 'image not found' }, 404);

  const absPath = imageAbsPath(image.path);
  const prompt = [
    '写っている内容・テキストをできる限り読み取ってください。',
    '施設名や住所が分かれば抽出してください。',
    '出力は JSON オブジェクト 1 個のみ:',
    '{ "analysis": "読み取った内容の要約 (日本語)", "address": "判明した住所 (無ければ空文字)" }',
  ].join('\n');

  const raw = await analyzeImage({ imagePath: absPath, prompt, model: config.llm.visionModel });

  // JSON 抽出は best-effort。失敗しても読み取りテキストは analysis_text に残す。
  let analysisText = raw;
  let extractedAddress: string | null = null;
  try {
    const obj = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
    if (typeof obj['analysis'] === 'string' && obj['analysis'].trim()) analysisText = obj['analysis'].trim();
    if (typeof obj['address'] === 'string' && obj['address'].trim()) extractedAddress = obj['address'].trim();
  } catch {
    // raw をそのまま analysis_text として保存する
  }

  let extractedLat: number | null = null;
  let extractedLng: number | null = null;
  let geocodeWarning: string | undefined;
  if (extractedAddress) {
    try {
      const geo = await geocodeCached(extractedAddress);
      if (geo) {
        extractedLat = geo.lat;
        extractedLng = geo.lng;
      }
    } catch (err) {
      if (err instanceof GeocodeNotConfiguredError) geocodeWarning = err.message;
      else throw err;
    }
  }

  const analysisId = newId();
  const now = nowIso();
  await sql`INSERT INTO image_analyses
    (id, place_id, composite_image_id, analysis_text, extracted_address, extracted_lat, extracted_lng, model, created_at)
    VALUES (${analysisId}, ${image.place_id}, ${image.id}, ${analysisText},
            ${extractedAddress}, ${extractedLat}, ${extractedLng}, ${config.llm.visionModel}, ${now})`;

  // 住所/座標が取れたら place を補完 (address は未設定時のみ、lat/lng は取得できたら立てる)。
  if (extractedAddress && extractedLat != null && extractedLng != null) {
    const [place] = (await sql`SELECT * FROM places WHERE id=${image.place_id}`) as Place[];
    if (place) {
      const newAddress = place.address ?? extractedAddress;
      await sql`UPDATE places SET address=${newAddress}, lat=${extractedLat}, lng=${extractedLng},
        updated_at=${nowIso()} WHERE id=${image.place_id}`;
    }
  }

  const [row] = (await sql`SELECT * FROM image_analyses WHERE id=${analysisId}`) as ImageAnalysis[];
  return c.json(geocodeWarning ? { ...row, geocodeWarning } : row);
});

export default app;
