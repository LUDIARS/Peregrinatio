import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { TripCheckItem, TripCheckListType, TripCheckStatus } from '../types.js';

const app = new Hono();

const LIST_TYPES: readonly TripCheckListType[] = ['packing', 'todo'];
const STATUSES: readonly TripCheckStatus[] = ['todo', 'doing', 'done'];

function validListType(v: unknown): v is TripCheckListType {
  return typeof v === 'string' && (LIST_TYPES as readonly string[]).includes(v);
}

function validStatus(v: unknown): v is TripCheckStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

app.get('/api/trips/:id/check-items', async (c) => {
  const tripId = c.req.param('id');
  const listType = c.req.query('list_type');
  if (listType && !validListType(listType)) return c.json({ error: 'invalid list_type' }, 400);

  const rows = listType
    ? (await sql`
        SELECT * FROM trip_check_items
        WHERE trip_id=${tripId} AND list_type=${listType}
        ORDER BY
          CASE status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
          order_index,
          created_at`) as TripCheckItem[]
    : (await sql`
        SELECT * FROM trip_check_items
        WHERE trip_id=${tripId}
        ORDER BY list_type,
          CASE status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
          order_index,
          created_at`) as TripCheckItem[];
  return c.json(rows);
});

app.post('/api/trips/:id/check-items', async (c) => {
  const tripId = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<TripCheckItem>;
  const title = String(b.title ?? '').trim();
  if (!title) return c.json({ error: 'title required' }, 400);
  const listType = validListType(b.list_type) ? b.list_type : 'todo';
  const status = validStatus(b.status) ? b.status : 'todo';
  const [cnt] = (await sql`
    SELECT COUNT(*) AS n FROM trip_check_items WHERE trip_id=${tripId} AND list_type=${listType}`) as { n: number }[];
  const id = newId();
  await sql`
    INSERT INTO trip_check_items
      (id, trip_id, list_type, title, details, status, quantity, category, due_at, order_index)
    VALUES
      (${id}, ${tripId}, ${listType}, ${title}, ${b.details ?? null}, ${status},
       ${typeof b.quantity === 'number' ? b.quantity : null}, ${b.category ?? null}, ${b.due_at ?? null}, ${cnt?.n ?? 0})`;
  const [row] = (await sql`SELECT * FROM trip_check_items WHERE id=${id}`) as TripCheckItem[];
  return c.json(row, 201);
});

app.patch('/api/check-items/:id', async (c) => {
  const id = c.req.param('id');
  const [before] = (await sql`SELECT * FROM trip_check_items WHERE id=${id}`) as TripCheckItem[];
  if (!before) return c.json({ error: 'not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Partial<TripCheckItem>;
  const patch: Partial<TripCheckItem> = {};
  if (typeof b.title === 'string') patch.title = b.title.trim();
  if (typeof b.details === 'string' || b.details === null) patch.details = b.details;
  if (validStatus(b.status)) patch.status = b.status;
  if (typeof b.quantity === 'number' || b.quantity === null) patch.quantity = b.quantity;
  if (typeof b.category === 'string' || b.category === null) patch.category = b.category;
  if (typeof b.due_at === 'string' || b.due_at === null) patch.due_at = b.due_at;
  if (typeof b.order_index === 'number') patch.order_index = b.order_index;

  await sql`
    UPDATE trip_check_items SET
      title=${patch.title ?? before.title},
      details=${Object.hasOwn(patch, 'details') ? patch.details ?? null : before.details},
      status=${patch.status ?? before.status},
      quantity=${Object.hasOwn(patch, 'quantity') ? patch.quantity ?? null : before.quantity},
      category=${Object.hasOwn(patch, 'category') ? patch.category ?? null : before.category},
      due_at=${Object.hasOwn(patch, 'due_at') ? patch.due_at ?? null : before.due_at},
      order_index=${patch.order_index ?? before.order_index},
      updated_at=datetime('now')
    WHERE id=${id}`;
  const [row] = (await sql`SELECT * FROM trip_check_items WHERE id=${id}`) as TripCheckItem[];
  return c.json(row);
});

app.delete('/api/check-items/:id', async (c) => {
  await sql`DELETE FROM trip_check_items WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
