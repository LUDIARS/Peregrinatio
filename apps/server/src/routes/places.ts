import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import type { Place } from '../types.js';

const app = new Hono();

app.get('/api/trips/:id/places', async (c) => {
  const rows = (await sql`SELECT * FROM places WHERE trip_id=${c.req.param('id')} ORDER BY created_at`) as Place[];
  return c.json(rows);
});

app.post('/api/trips/:id/places', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<Place>;
  if (!b.name) return c.json({ error: 'name required' }, 400);
  const id = newId();
  const now = nowIso();
  await sql`INSERT INTO places (id, trip_id, name, address, lat, lng, category, source_url, notes, pinned, created_at, updated_at)
    VALUES (${id}, ${trip_id}, ${b.name}, ${b.address ?? null}, ${b.lat ?? null}, ${b.lng ?? null},
            ${b.category ?? null}, ${b.source_url ?? null}, ${b.notes ?? null}, ${b.pinned ?? 1}, ${now}, ${now})`;
  const [p] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  return c.json(p);
});

app.patch('/api/places/:id', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = pick<Place>(await c.req.json().catch(() => ({})), [
    'name', 'address', 'lat', 'lng', 'category', 'source_url', 'summary', 'notes', 'pinned',
  ]);
  const m = { ...cur, ...b };
  const now = nowIso();
  await sql`UPDATE places SET name=${m.name}, address=${m.address}, lat=${m.lat}, lng=${m.lng},
    category=${m.category}, source_url=${m.source_url}, summary=${m.summary}, notes=${m.notes},
    pinned=${m.pinned}, updated_at=${now} WHERE id=${id}`;
  const [p] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  return c.json(p);
});

app.delete('/api/places/:id', async (c) => {
  await sql`DELETE FROM places WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
