import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick, userOf } from '../lib/http.js';
import { geocodeCached, GeocodeNotConfiguredError } from '../lib/geocode.js';
import type { Place, TripPlace } from '../types.js';

const app = new Hono();

// ---- ライブラリ (全旅共有) ----

/** GET /api/places — 場所ライブラリ。?status= / ?q= で絞り込み。 */
app.get('/api/places', async (c) => {
  const status = c.req.query('status');
  const q = c.req.query('q');
  let rows: Place[];
  if (status && q) {
    rows = (await sql`SELECT * FROM places WHERE status=${status} AND name LIKE ${'%' + q + '%'} ORDER BY updated_at DESC`) as Place[];
  } else if (status) {
    rows = (await sql`SELECT * FROM places WHERE status=${status} ORDER BY updated_at DESC`) as Place[];
  } else if (q) {
    rows = (await sql`SELECT * FROM places WHERE name LIKE ${'%' + q + '%'} ORDER BY updated_at DESC`) as Place[];
  } else {
    rows = (await sql`SELECT * FROM places ORDER BY updated_at DESC`) as Place[];
  }
  return c.json(rows);
});

/** PATCH /api/places/:id — 場所そのもの (ライブラリ) の編集。status もここで。 */
app.patch('/api/places/:id', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = pick<Place>(await c.req.json().catch(() => ({})), [
    'name', 'address', 'lat', 'lng', 'category', 'source_url', 'summary', 'notes', 'image_url', 'status',
  ]);
  const m = { ...cur, ...b };
  const now = nowIso();
  // 状態 (気になる/訪問済み) を変更した時だけ、変更者の表示名を記録する。
  const statusBy = 'status' in b ? userOf(c) : cur.status_by;
  await sql`UPDATE places SET name=${m.name}, address=${m.address}, lat=${m.lat}, lng=${m.lng},
    category=${m.category}, source_url=${m.source_url}, summary=${m.summary}, notes=${m.notes},
    image_url=${m.image_url}, status=${m.status}, status_by=${statusBy}, updated_at=${now} WHERE id=${id}`;
  const [p] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  return c.json(p);
});

/** POST /api/places/:id/geocode — 住所から緯度経度を取得し、場所に反映する。 */
app.post('/api/places/:id/geocode', async (c) => {
  const id = c.req.param('id');
  const [cur] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!cur) return c.json({ error: 'not found' }, 404);

  const b = (await c.req.json().catch(() => ({}))) as { address?: string };
  const address = (b.address ?? cur.address ?? '').trim();
  if (!address) return c.json({ error: '住所を入力してください' }, 400);

  try {
    const loc = await geocodeCached(address);
    if (!loc) return c.json({ error: '住所から場所を特定できませんでした (住所を見直してください)' }, 422);
    await sql`UPDATE places SET address=${address}, lat=${loc.lat}, lng=${loc.lng}, updated_at=${nowIso()} WHERE id=${id}`;
    const [updated] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
    return c.json(updated);
  } catch (e) {
    if (e instanceof GeocodeNotConfiguredError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

/** DELETE /api/places/:id — ライブラリから完全削除 (全旅の紐付け/画像/リンクも cascade)。 */
app.delete('/api/places/:id', async (c) => {
  await sql`DELETE FROM places WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// ---- 旅 ↔ 場所 メンバーシップ ----

/** GET /api/trips/:id/places — この旅に紐づく場所 (is_base 付き)。 */
app.get('/api/trips/:id/places', async (c) => {
  const rows = (await sql`
    SELECT p.*, tp.is_base, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${c.req.param('id')}
      AND NOT EXISTS (
        SELECT 1 FROM place_jobs j
        WHERE j.place_id = p.id AND j.trip_id = tp.trip_id AND j.is_new_place = 1
          AND j.status IN ('pending','processing','needs_info','failed')
      )
    ORDER BY CASE WHEN p.status='interested' THEN 0 ELSE 1 END, tp.added_at DESC`) as TripPlace[];
  return c.json(rows);
});

/**
 * POST /api/trips/:id/places — 場所を旅に追加。
 * body.place_id があれば既存ライブラリ場所を紐付け、無ければ新規作成して紐付ける。
 */
app.post('/api/trips/:id/places', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<Place> & { place_id?: string; is_base?: number };
  const now = nowIso();

  let placeId = b.place_id;
  if (!placeId) {
    if (!b.name) return c.json({ error: 'name required' }, 400);
    placeId = newId();
    const statusBy = b.status && b.status !== 'none' ? userOf(c) : null;
    await sql`INSERT INTO places (id, name, address, lat, lng, category, source_url, notes, image_url, status, status_by, created_at, updated_at)
      VALUES (${placeId}, ${b.name}, ${b.address ?? null}, ${b.lat ?? null}, ${b.lng ?? null}, ${b.category ?? null},
              ${b.source_url ?? null}, ${b.notes ?? null}, ${b.image_url ?? null}, ${b.status ?? 'none'}, ${statusBy}, ${now}, ${now})`;
  }

  await sql`INSERT OR IGNORE INTO trip_places (trip_id, place_id, is_base, added_at)
    VALUES (${trip_id}, ${placeId}, ${b.is_base ?? 0}, ${now})`;

  const [p] = (await sql`
    SELECT p.*, tp.is_base, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE p.id = ${placeId} AND tp.trip_id = ${trip_id}`) as TripPlace[];
  return c.json(p);
});

/** PATCH /api/trips/:id/places/:placeId — この旅でのメンバーシップ (is_base 切替 / 拠点ホテルの IN・OUT / また今度)。 */
app.patch('/api/trips/:id/places/:placeId', async (c) => {
  const trip_id = c.req.param('id');
  const placeId = c.req.param('placeId');
  const b = (await c.req.json().catch(() => ({}))) as {
    is_base?: number; checkin_time?: string | null; checkout_time?: string | null; postponed?: number;
  };
  if (typeof b.is_base === 'number') {
    await sql`UPDATE trip_places SET is_base=${b.is_base} WHERE trip_id=${trip_id} AND place_id=${placeId}`;
  }
  if ('checkin_time' in b) {
    await sql`UPDATE trip_places SET checkin_time=${b.checkin_time ?? null} WHERE trip_id=${trip_id} AND place_id=${placeId}`;
  }
  if ('checkout_time' in b) {
    await sql`UPDATE trip_places SET checkout_time=${b.checkout_time ?? null} WHERE trip_id=${trip_id} AND place_id=${placeId}`;
  }
  if (typeof b.postponed === 'number') {
    await sql`UPDATE trip_places SET postponed=${b.postponed} WHERE trip_id=${trip_id} AND place_id=${placeId}`;
  }
  const [p] = (await sql`
    SELECT p.*, tp.is_base, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE p.id = ${placeId} AND tp.trip_id = ${trip_id}`) as TripPlace[];
  if (!p) return c.json({ error: 'not found' }, 404);
  return c.json(p);
});

/** DELETE /api/trips/:id/places/:placeId — 旅から外す (場所自体はライブラリに残す)。 */
app.delete('/api/trips/:id/places/:placeId', async (c) => {
  await sql`DELETE FROM trip_places WHERE trip_id=${c.req.param('id')} AND place_id=${c.req.param('placeId')}`;
  return c.json({ ok: true });
});

export default app;
