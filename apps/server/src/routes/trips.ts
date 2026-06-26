import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import type { Trip, TripDay, TripPlace } from '../types.js';

const app = new Hono();

app.get('/api/trips', async (c) => {
  const rows = (await sql`SELECT * FROM trips ORDER BY created_at DESC`) as Trip[];
  return c.json(rows);
});

app.post('/api/trips', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Partial<Trip>;
  if (!b.title) return c.json({ error: 'title required' }, 400);
  const id = newId();
  const now = nowIso();
  await sql`INSERT INTO trips (id, title, start_date, end_date, notes, created_at, updated_at)
    VALUES (${id}, ${b.title}, ${b.start_date ?? null}, ${b.end_date ?? null}, ${b.notes ?? null}, ${now}, ${now})`;
  const [t] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  return c.json(t);
});

app.get('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  if (!trip) return c.json({ error: 'not found' }, 404);
  const days = (await sql`SELECT * FROM trip_days WHERE trip_id=${id} ORDER BY day_index`) as TripDay[];
  const places = (await sql`
    SELECT p.*, tp.is_base FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${id}
    ORDER BY tp.added_at`) as TripPlace[];
  return c.json({ trip, days, places });
});

app.patch('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = pick<Trip>(await c.req.json().catch(() => ({})), [
    'title', 'start_date', 'end_date', 'notes', 'cover_image_path', 'archived',
  ]);
  const m = { ...cur, ...b };
  const now = nowIso();
  await sql`UPDATE trips SET title=${m.title}, start_date=${m.start_date}, end_date=${m.end_date},
    notes=${m.notes}, cover_image_path=${m.cover_image_path}, archived=${m.archived}, updated_at=${now} WHERE id=${id}`;
  const [t] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  return c.json(t);
});

app.delete('/api/trips/:id', async (c) => {
  await sql`DELETE FROM trips WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
