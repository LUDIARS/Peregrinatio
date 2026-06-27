import { Hono } from 'hono';
import { geocode } from '@peregrinatio/places';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import { enumerateDates } from '../lib/dates.js';
import { config } from '../config.js';
import { getHome } from '../settings/home.js';
import type { OriginKind, Trip, TripDay, TripPlace } from '../types.js';

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

  // 日程が決まっていれば「旅のしおり」の日にちを自動生成する (後でしおり側で調整可)。
  if (b.start_date && b.end_date) {
    const dates = enumerateDates(b.start_date, b.end_date);
    for (let i = 0; i < dates.length; i++) {
      await sql`INSERT INTO trip_days (id, trip_id, day_index, date, title, notes)
        VALUES (${newId()}, ${id}, ${i}, ${dates[i]!}, ${null}, ${null})`;
    }
  }

  const [t] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  return c.json(t);
});

app.get('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  if (!trip) return c.json({ error: 'not found' }, 404);
  const days = (await sql`SELECT * FROM trip_days WHERE trip_id=${id} ORDER BY day_index`) as TripDay[];
  const places = (await sql`
    SELECT p.*, tp.is_base, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${id}
    ORDER BY CASE WHEN p.status='interested' THEN 0 ELSE 1 END, tp.added_at DESC`) as TripPlace[];
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

// 出発地点 (自宅/集合地点) を設定する。座標はスナップショットして旅に保持する
// (自宅は app_settings から、集合地点はジオコーディングから)。初日往路+最終日復路の再計算は
// クライアントが /api/days/:id/route を呼んで行う。
app.put('/api/trips/:id/origin', async (c) => {
  const id = c.req.param('id');
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  if (!trip) return c.json({ error: 'not found' }, 404);

  const b = (await c.req.json().catch(() => ({}))) as { kind?: OriginKind; address?: string; label?: string };
  const kind: OriginKind = b.kind ?? 'none';
  const now = nowIso();

  if (kind === 'none') {
    await sql`UPDATE trips SET origin_kind='none', origin_label=NULL, origin_address=NULL,
      origin_lat=NULL, origin_lng=NULL, updated_at=${now} WHERE id=${id}`;
  } else if (kind === 'home') {
    const home = await getHome();
    if (!home) return c.json({ error: '自宅が未設定です (設定ページで登録してください)' }, 400);
    await sql`UPDATE trips SET origin_kind='home', origin_label='自宅', origin_address=${home.address},
      origin_lat=${home.lat}, origin_lng=${home.lng}, updated_at=${now} WHERE id=${id}`;
  } else if (kind === 'meeting') {
    const address = (b.address ?? '').trim();
    if (!address) return c.json({ error: '集合地点の住所を入力してください' }, 400);
    if (!config.googleMaps.apiKey) {
      return c.json({ error: 'googleMaps.apiKey 未設定: 住所を座標化できません' }, 400);
    }
    const loc = await geocode(address, config.googleMaps.apiKey);
    if (!loc) return c.json({ error: '住所から場所を特定できませんでした (住所を見直してください)' }, 422);
    const label = (b.label ?? '').trim() || '集合地点';
    await sql`UPDATE trips SET origin_kind='meeting', origin_label=${label}, origin_address=${address},
      origin_lat=${loc.lat}, origin_lng=${loc.lng}, updated_at=${now} WHERE id=${id}`;
  } else {
    return c.json({ error: `未知の出発地点種別: ${String(b.kind)}` }, 400);
  }

  const [t] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  return c.json(t);
});

app.delete('/api/trips/:id', async (c) => {
  await sql`DELETE FROM trips WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

export default app;
