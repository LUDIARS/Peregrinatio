// GTFS / GTFS-JP 時刻表の取込・管理・参照 API。
//   POST   /api/gtfs/import                 zip URL を取り込む (フィード作成)
//   GET    /api/gtfs/feeds                  取込済みフィード一覧
//   DELETE /api/gtfs/feeds/:id              フィード削除 (cascade)
//   GET    /api/gtfs/stops/nearby           近くの停留所 (距離順)
//   GET    /api/gtfs/feeds/:id/stops/:sid/departures  停留所の発車時刻ボード

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { importGtfsFromUrl } from '../lib/gtfs-import.js';
import { nearbyStops, stopDepartures, listRoutes, routeTimetable } from '../lib/gtfs-query.js';
import type { GtfsFeed } from '../types.js';

const app = new Hono();

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

app.get('/api/gtfs/feeds', async (c) => {
  const rows = (await sql`SELECT * FROM gtfs_feeds ORDER BY imported_at DESC`) as GtfsFeed[];
  return c.json(rows);
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
