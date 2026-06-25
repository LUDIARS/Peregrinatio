import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import type { ItineraryItem } from '../types.js';

const app = new Hono();

app.get('/api/days/:id/items', async (c) => {
  const rows = (await sql`SELECT * FROM itinerary_items WHERE day_id=${c.req.param('id')} ORDER BY order_index`) as ItineraryItem[];
  return c.json(rows);
});

app.post('/api/days/:id/items', async (c) => {
  const day_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<ItineraryItem>;
  const cnt = (await sql`SELECT COUNT(*) AS n FROM itinerary_items WHERE day_id=${day_id}`) as { n: number }[];
  const n = cnt[0]?.n ?? 0;
  const id = newId();
  await sql`INSERT INTO itinerary_items (id, day_id, place_id, order_index, planned_time, kind, note)
    VALUES (${id}, ${day_id}, ${b.place_id ?? null}, ${b.order_index ?? n}, ${b.planned_time ?? null},
            ${b.kind ?? 'visit'}, ${b.note ?? null})`;
  const [it] = (await sql`SELECT * FROM itinerary_items WHERE id=${id}`) as ItineraryItem[];
  return c.json(it);
});

app.patch('/api/items/:id', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM itinerary_items WHERE id=${id}`) as ItineraryItem[];
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = pick<ItineraryItem>(await c.req.json().catch(() => ({})), [
    'place_id', 'order_index', 'planned_time', 'kind', 'note',
  ]);
  const m = { ...cur, ...b };
  await sql`UPDATE itinerary_items SET place_id=${m.place_id}, order_index=${m.order_index},
    planned_time=${m.planned_time}, kind=${m.kind}, note=${m.note} WHERE id=${id}`;
  const [it] = (await sql`SELECT * FROM itinerary_items WHERE id=${id}`) as ItineraryItem[];
  return c.json(it);
});

app.delete('/api/items/:id', async (c) => {
  await sql`DELETE FROM itinerary_items WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
