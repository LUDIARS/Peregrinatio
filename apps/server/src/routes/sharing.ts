import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../sharing/password.js';
import type { Trip } from '../types.js';

interface ShareRow {
  trip_id: string;
  token: string;
  password_salt: string | null;
  password_hash: string | null;
}

const app = new Hono();

function publicTrip(trip: Trip) {
  return {
    trip_id: trip.id,
    title: trip.title,
    start_date: trip.start_date,
    end_date: trip.end_date,
  };
}

async function shareByToken(token: string): Promise<ShareRow | null> {
  const [share] = (await sql`SELECT * FROM trip_shares WHERE token=${token}`) as ShareRow[];
  return share ?? null;
}

app.get('/api/trips/:id/share', async (c) => {
  const tripId = c.req.param('id');
  const [trip] = (await sql`SELECT id FROM trips WHERE id=${tripId}`) as { id: string }[];
  if (!trip) return c.json({ error: 'not found' }, 404);
  const [share] = (await sql`SELECT * FROM trip_shares WHERE trip_id=${tripId}`) as ShareRow[];
  return c.json(share ? { token: share.token, password_protected: Boolean(share.password_hash) } : null);
});

app.put('/api/trips/:id/share', async (c) => {
  const tripId = c.req.param('id');
  const [trip] = (await sql`SELECT id FROM trips WHERE id=${tripId}`) as { id: string }[];
  if (!trip) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { password?: string | null };
  if (typeof body.password === 'string' && body.password.length > 128) {
    return c.json({ error: '合言葉は128文字以内で入力してください' }, 400);
  }
  const password = body.password?.trim() ? body.password : null;
  const digest = password ? hashPassword(password) : null;
  const [existing] = (await sql`SELECT * FROM trip_shares WHERE trip_id=${tripId}`) as ShareRow[];
  const token = existing?.token ?? randomBytes(24).toString('base64url');
  const now = nowIso();
  await sql`INSERT INTO trip_shares (trip_id, token, password_salt, password_hash, created_at, updated_at)
    VALUES (${tripId}, ${token}, ${digest?.salt ?? null}, ${digest?.hash ?? null}, ${now}, ${now})
    ON CONFLICT(trip_id) DO UPDATE SET password_salt=excluded.password_salt,
      password_hash=excluded.password_hash, updated_at=excluded.updated_at`;
  return c.json({ token, password_protected: Boolean(digest) });
});

app.get('/api/shares/:token', async (c) => {
  const share = await shareByToken(c.req.param('token'));
  if (!share) return c.json({ error: '共有リンクが見つかりません' }, 404);
  const protectedByPassword = Boolean(share.password_hash);
  if (protectedByPassword) return c.json({ password_protected: true });
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${share.trip_id}`) as Trip[];
  if (!trip) return c.json({ error: '旅が見つかりません' }, 404);
  return c.json({ password_protected: false, trip: publicTrip(trip) });
});

app.post('/api/shares/:token/unlock', async (c) => {
  const share = await shareByToken(c.req.param('token'));
  if (!share) return c.json({ error: '共有リンクが見つかりません' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (share.password_hash && share.password_salt && !verifyPassword(body.password ?? '', {
    salt: share.password_salt,
    hash: share.password_hash,
  })) return c.json({ error: '合言葉が違います' }, 401);
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${share.trip_id}`) as Trip[];
  if (!trip) return c.json({ error: '旅が見つかりません' }, 404);
  return c.json({ trip: publicTrip(trip) });
});

export default app;
