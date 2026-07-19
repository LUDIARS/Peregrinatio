// 拠点ホテルのチェックイン/チェックアウト時刻 自動取得。
//   POST /api/trips/:tripId/places/:placeId/hotel-times
//     place.source_url か Places 検索の websiteUri を PoliteFetcher で取得 →
//     LLM (claude CLI) で IN/OUT 時刻を JSON 抽出 → trip_places.checkin_time/checkout_time を更新。
// キー未設定や取得不能は silent fallback せず明示エラー ([[feedback_no_silent_fallback]])。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import { PoliteFetcher, htmlToText } from '@peregrinatio/crawl';
import { searchPlaces } from '@peregrinatio/places';
import { complete, extractJsonBlock } from '@peregrinatio/llm';
import type { TripPlace } from '../types.js';

const app = new Hono();

/** 'HH:MM' らしき文字列なら正規化、それ以外は null。 */
function normTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

app.post('/api/trips/:tripId/places/:placeId/hotel-times', async (c) => {
  const tripId = c.req.param('tripId');
  const placeId = c.req.param('placeId');

  const [member] = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE p.id = ${placeId} AND tp.trip_id = ${tripId}`) as TripPlace[];
  if (!member) return c.json({ error: 'この旅に該当の場所がありません' }, 404);

  // 取得元 URL を決める: source_url 優先、無ければ Places 検索の公式サイト。
  let url = (member.source_url ?? '').trim();
  if (!url) {
    if (!config.googleMaps.apiKey) {
      return c.json(
        { error: 'source_url 未設定かつ googleMaps.apiKey 未設定: 公式サイトを特定できません' },
        400,
      );
    }
    const results = await searchPlaces(
      { q: member.name, lat: member.lat ?? undefined, lng: member.lng ?? undefined },
      config.googleMaps.apiKey,
    );
    url = (results[0]?.websiteUri ?? '').trim();
    if (!url) return c.json({ error: '公式サイトが見つかりませんでした (手入力で設定してください)' }, 404);
  }

  const fetcher = new PoliteFetcher({
    userAgent: config.crawl.userAgent,
    fetchTimeoutMs: config.crawl.fetchTimeoutMs,
    minIntervalMs: config.crawl.minIntervalMs,
    respectRobots: config.crawl.respectRobots,
  });
  const res = await fetcher.fetch(url);
  if (!res.ok) return c.json({ error: `取得に失敗しました (${res.reason}): ${res.message}` }, 502);

  const text = htmlToText(res.html);
  const raw = await complete({
    system: 'あなたは宿泊施設ページから情報を抽出するアシスタントです。出力は JSON オブジェクト 1 個のみ。',
    user: [
      `次の宿泊施設「${member.name}」のページ本文から、標準のチェックイン/チェックアウト時刻を抽出してください。`,
      '時刻は 24 時間表記 "HH:MM"。記載が無ければ空文字にしてください。',
      '出力フォーマット: { "checkin": "15:00", "checkout": "10:00" }',
      '--- 本文 ---',
      text,
    ].join('\n'),
    model: config.llm.summaryModel,
  });

  let checkin: string | null = null;
  let checkout: string | null = null;
  try {
    const obj = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
    checkin = normTime(obj['checkin']);
    checkout = normTime(obj['checkout']);
  } catch {
    return c.json({ error: 'チェックイン/アウト時刻を抽出できませんでした (手入力で設定してください)' }, 422);
  }

  if (!checkin && !checkout) {
    return c.json({ error: 'ページから時刻を読み取れませんでした (手入力で設定してください)' }, 422);
  }

  // 取得できた項目だけ更新 (片方のみでも反映)。既存 source_url 空なら今回の URL を保存。
  if (checkin) {
    await sql`UPDATE trip_places SET checkin_time=${checkin} WHERE trip_id=${tripId} AND place_id=${placeId}`;
  }
  if (checkout) {
    await sql`UPDATE trip_places SET checkout_time=${checkout} WHERE trip_id=${tripId} AND place_id=${placeId}`;
  }
  if (!member.source_url) {
    await sql`UPDATE places SET source_url=${url}, updated_at=${nowIso()} WHERE id=${placeId}`;
  }

  const [updated] = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE p.id = ${placeId} AND tp.trip_id = ${tripId}`) as TripPlace[];
  return c.json(updated);
});

export default app;
