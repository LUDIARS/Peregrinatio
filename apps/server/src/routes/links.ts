import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import type { PlaceLink } from '../types.js';

const app = new Hono();

/** GET /api/places/:id/links — 場所の資料 (Web ページ) 一覧。 */
app.get('/api/places/:id/links', async (c) => {
  const rows = (await sql`SELECT * FROM place_links WHERE place_id=${c.req.param('id')} ORDER BY created_at`) as PlaceLink[];
  return c.json(rows);
});

/** POST /api/places/:id/links — 資料 Web ページを追加。 */
app.post('/api/places/:id/links', async (c) => {
  const place_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<PlaceLink>;
  if (!b.url) return c.json({ error: 'url required' }, 400);
  const id = newId();
  await sql`INSERT INTO place_links (id, place_id, url, title, source, created_at)
    VALUES (${id}, ${place_id}, ${b.url}, ${b.title ?? null}, ${b.source ?? 'manual'}, ${nowIso()})`;
  const [l] = (await sql`SELECT * FROM place_links WHERE id=${id}`) as PlaceLink[];
  return c.json(l);
});

/** DELETE /api/links/:id — 資料リンク削除。 */
app.delete('/api/links/:id', async (c) => {
  await sql`DELETE FROM place_links WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
