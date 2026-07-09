// 取り込みジョブ (画像解析/クロール) のキュー API。
//   POST   /api/trips/:id/jobs   ジョブを積む (pending)
//   GET    /api/trips/:id/jobs   この旅のキュー一覧 (place 名付き)
//   POST   /api/jobs/:id/retry   失敗/情報不足を再実行 (pending に戻す)
//   DELETE /api/jobs/:id         ジョブ破棄 (未成立のドラフト place は一緒に掃除)
// 実処理は jobs/queue.ts の worker が pending を 1 件ずつ拾って行う。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import type { PlaceJob, PlaceJobView, PlaceJobKind } from '../types.js';

const app = new Hono();

async function rememberCrawlUrl(placeId: string, url: string): Promise<void> {
  const cleanUrl = url.trim();
  if (!cleanUrl) return;
  const [exist] = (await sql`
    SELECT id FROM place_links WHERE place_id=${placeId} AND url=${cleanUrl} LIMIT 1`) as { id: string }[];
  if (!exist) {
    await sql`INSERT INTO place_links (id, place_id, url, title, source, created_at)
      VALUES (${newId()}, ${placeId}, ${cleanUrl}, ${null}, ${'crawl'}, ${nowIso()})`;
  }
  await sql`
    UPDATE places
    SET source_url=COALESCE(source_url, ${cleanUrl}), updated_at=${nowIso()}
    WHERE id=${placeId}`;
}

app.post('/api/trips/:id/jobs', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as {
    place_id?: string; kind?: PlaceJobKind; source_url?: string; is_new_place?: number;
  };
  if (!b.place_id) return c.json({ error: 'place_id required' }, 400);
  if (b.kind !== 'image' && b.kind !== 'crawl') return c.json({ error: 'kind は image | crawl' }, 400);
  if (b.kind === 'crawl' && !b.source_url) return c.json({ error: 'crawl は source_url が必要です' }, 400);

  const id = newId();
  const now = nowIso();
  if (b.kind === 'crawl' && b.source_url) {
    await rememberCrawlUrl(b.place_id, b.source_url);
  }
  await sql`INSERT INTO place_jobs (id, trip_id, place_id, kind, status, source_url, is_new_place, created_at, updated_at)
    VALUES (${id}, ${trip_id}, ${b.place_id}, ${b.kind}, 'pending', ${b.source_url ?? null}, ${b.is_new_place ? 1 : 0}, ${now}, ${now})`;
  const [job] = (await sql`SELECT * FROM place_jobs WHERE id=${id}`) as PlaceJob[];
  return c.json(job);
});

app.get('/api/trips/:id/jobs', async (c) => {
  const rows = (await sql`
    SELECT j.*, p.name AS place_name FROM place_jobs j
    LEFT JOIN places p ON p.id = j.place_id
    WHERE j.trip_id = ${c.req.param('id')}
    ORDER BY j.created_at DESC`) as PlaceJobView[];
  return c.json(rows);
});

app.post('/api/jobs/:id/retry', async (c) => {
  const id = c.req.param('id');
  await sql`UPDATE place_jobs SET status='pending', error=NULL, missing_info=NULL, updated_at=${nowIso()} WHERE id=${id}`;
  const [job] = (await sql`SELECT * FROM place_jobs WHERE id=${id}`) as PlaceJob[];
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json(job);
});

app.delete('/api/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const [job] = (await sql`SELECT * FROM place_jobs WHERE id=${id}`) as PlaceJob[];
  if (!job) return c.json({ ok: true });
  await sql`DELETE FROM place_jobs WHERE id=${id}`;

  // 取り込みで作った新規ドラフトが成立しないまま破棄された場合は place ごと掃除する
  // (他にジョブが残っていない時のみ)。trip_places / 画像 / 解析は cascade で消える。
  if (job.is_new_place === 1 && job.status !== 'done') {
    const [cnt] = (await sql`SELECT COUNT(*) AS n FROM place_jobs WHERE place_id=${job.place_id}`) as { n: number }[];
    if (!cnt || Number(cnt.n) === 0) {
      await sql`DELETE FROM places WHERE id=${job.place_id}`;
    }
  }
  return c.json({ ok: true });
});

export default app;
