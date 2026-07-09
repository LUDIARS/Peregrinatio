// GTFS / GTFS-JP 時刻表の取込・管理・参照 API。
//   POST   /api/gtfs/import                 zip URL を取り込む (フィード作成)
//   GET    /api/gtfs/feeds                  取込済みフィード一覧
//   DELETE /api/gtfs/feeds/:id              フィード削除 (cascade)
//   GET    /api/gtfs/stops/nearby           近くの停留所 (距離順)
//   GET    /api/gtfs/feeds/:id/stops/:sid/departures  停留所の発車時刻ボード

import { Hono } from 'hono';
import { PoliteFetcher, htmlToText } from '@peregrinatio/crawl';
import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { sql } from '../db/index.js';
import { importGtfsFromUrl } from '../lib/gtfs-import.js';
import { nearbyStops, stopDepartures, listRoutes, routeTimetable, feedStops, listRouteSummaries, searchRouteGraph } from '../lib/gtfs-query.js';
import { config } from '../config.js';
import type { GtfsFeed } from '../types.js';

const app = new Hono();

const ROUTE_IMPORT_SYSTEM =
  'あなたは交通事業者の路線情報ページから、機械可読な時刻表データのURLを抽出するアシスタントです。出力は JSON オブジェクト 1 個のみ。';

/** Asia/Tokyo の現在日時 (date=YYYYMMDD, time=HH:MM:SS)。 */
function tokyoNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}${get('month')}${get('day')}`;
  let hh = get('hour');
  if (hh === '24') hh = '00';
  return { date, time: `${hh}:${get('minute')}:${get('second')}` };
}

app.post('/api/gtfs/import', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { url?: string; name?: string };
  const url = (b.url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return c.json({ error: 'GTFS zip の URL を指定してください' }, 400);
  try {
    const feed = await importGtfsFromUrl(url, b.name);
    return c.json(feed);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'GTFS の取込に失敗しました' }, 502);
  }
});

function findZipUrl(text: string): string | null {
  const m = /https?:\/\/[^\s"'<>）)]+\.zip(?:\?[^\s"'<>）)]*)?/i.exec(text);
  return m?.[0] ?? null;
}

async function extractImportTargetFromPage(url: string): Promise<{ url: string; name?: string }> {
  const fetcher = new PoliteFetcher({
    userAgent: config.crawl.userAgent,
    fetchTimeoutMs: config.crawl.fetchTimeoutMs,
    minIntervalMs: config.crawl.minIntervalMs,
    respectRobots: config.crawl.respectRobots,
  });
  const res = await fetcher.fetch(url);
  if (!res.ok) throw new Error(`ページを取得できませんでした (${res.reason}): ${res.message}`);

  const direct = findZipUrl(res.html);
  if (direct) return { url: new URL(direct, res.finalUrl).toString() };

  const text = htmlToText(res.html);
  const raw = await complete({
    system: ROUTE_IMPORT_SYSTEM,
    user: [
      '次のページ本文から、GTFS / GTFS-JP / 標準的な公共交通オープンデータの zip URL を 1 つ抽出してください。',
      '見つからない場合は gtfs_url を空文字にしてください。事業者名や路線名が分かる場合は name に入れてください。',
      '出力フォーマット: { "gtfs_url": "https://example.com/feed.zip", "name": "表示名" }',
      '--- 本文 ---',
      text,
    ].join('\n'),
    model: config.llm.summaryModel,
  });
  const parsed = JSON.parse(extractJsonBlock(raw)) as { gtfs_url?: unknown; name?: unknown };
  const candidate = typeof parsed.gtfs_url === 'string' ? parsed.gtfs_url.trim() : '';
  if (!candidate) throw new Error('ページから取り込み可能な路線データ URL を見つけられませんでした');
  return {
    url: new URL(candidate, res.finalUrl).toString(),
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined,
  };
}

app.post('/api/gtfs/import-from-page', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { url?: string; name?: string };
  const url = (b.url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return c.json({ error: '路線情報ページの URL を指定してください' }, 400);
  try {
    const target = /\.zip(?:$|\?)/i.test(url) ? { url, name: b.name } : await extractImportTargetFromPage(url);
    const feed = await importGtfsFromUrl(target.url, b.name || target.name);
    return c.json({ feed, source_url: target.url });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '路線情報の取込に失敗しました' }, 502);
  }
});

app.get('/api/gtfs/feeds', async (c) => {
  const rows = (await sql`SELECT * FROM gtfs_feeds ORDER BY imported_at DESC`) as GtfsFeed[];
  return c.json(rows);
});

app.get('/api/gtfs/routes', async (c) => {
  return c.json(await listRouteSummaries());
});

app.post('/api/gtfs/route-search', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as {
    from?: { lat?: number; lng?: number };
    to?: { lat?: number; lng?: number };
    date?: string;
    time?: string;
    basis?: 'departure' | 'arrival';
  };
  const fromLat = Number(b.from?.lat);
  const fromLng = Number(b.from?.lng);
  const toLat = Number(b.to?.lat);
  const toLng = Number(b.to?.lng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    return c.json({ error: '出発地と到着地の座標が必要です' }, 400);
  }
  const date = String(b.date || tokyoNow().date).replace(/-/g, '');
  const time = String(b.time || tokyoNow().time);
  const basis = b.basis === 'arrival' ? 'arrival' : 'departure';
  return c.json(await searchRouteGraph({
    from: { lat: fromLat, lng: fromLng },
    to: { lat: toLat, lng: toLng },
    date,
    time,
    basis,
  }));
});

app.delete('/api/gtfs/feeds/:id', async (c) => {
  await sql`DELETE FROM gtfs_feeds WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

app.get('/api/gtfs/stops/nearby', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat / lng が必要です' }, 400);
  }
  const radius = Number(c.req.query('radius'));
  const limit = Number(c.req.query('limit'));
  const hits = await nearbyStops(
    lat, lng,
    Number.isFinite(radius) ? radius : 500,
    Number.isFinite(limit) ? limit : 8,
  );
  return c.json(hits);
});

app.get('/api/gtfs/feeds/:id/routes', async (c) => {
  return c.json(await listRoutes(c.req.param('id')));
});

app.get('/api/gtfs/feeds/:id/stops', async (c) => {
  return c.json(await feedStops(c.req.param('id')));
});

app.get('/api/gtfs/feeds/:id/routes/:rid/timetable', async (c) => {
  const date = (c.req.query('date') || tokyoNow().date).replace(/-/g, '');
  return c.json(await routeTimetable(c.req.param('id'), c.req.param('rid'), date));
});

app.get('/api/gtfs/feeds/:id/stops/:sid/departures', async (c) => {
  const feedId = c.req.param('id');
  const stopId = c.req.param('sid');
  const now = tokyoNow();
  const date = (c.req.query('date') || now.date).replace(/-/g, '');
  const after = c.req.query('after') || now.time;
  const limit = Number(c.req.query('limit'));
  const deps = await stopDepartures(feedId, stopId, date, after, Number.isFinite(limit) ? limit : 12);
  return c.json(deps);
});

export default app;
