import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import type { TripDay } from '../types.js';

const app = new Hono();

app.get('/api/trips/:id/days', async (c) => {
  const rows = (await sql`SELECT * FROM trip_days WHERE trip_id=${c.req.param('id')} ORDER BY day_index`) as TripDay[];
  return c.json(rows);
});

app.post('/api/trips/:id/days', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<TripDay>;
  const cnt = (await sql`SELECT COUNT(*) AS n FROM trip_days WHERE trip_id=${trip_id}`) as { n: number }[];
  const n = cnt[0]?.n ?? 0;
  const id = newId();
  await sql`INSERT INTO trip_days (id, trip_id, day_index, date, title, notes)
    VALUES (${id}, ${trip_id}, ${n}, ${b.date ?? null}, ${b.title ?? null}, ${b.notes ?? null})`;
  const [d] = (await sql`SELECT * FROM trip_days WHERE id=${id}`) as TripDay[];
  return c.json(d);
});

app.patch('/api/days/:id', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM trip_days WHERE id=${id}`) as TripDay[];
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = pick<TripDay>(await c.req.json().catch(() => ({})), ['date', 'title', 'notes']);
  const m = { ...cur, ...b };
  await sql`UPDATE trip_days SET date=${m.date}, title=${m.title}, notes=${m.notes} WHERE id=${id}`;
  const [d] = (await sql`SELECT * FROM trip_days WHERE id=${id}`) as TripDay[];
  return c.json(d);
});

app.delete('/api/days/:id', async (c) => {
  await sql`DELETE FROM trip_days WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
