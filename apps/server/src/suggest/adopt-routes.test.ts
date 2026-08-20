// 提案の採用 API。破壊的更新の前に入力全体を検証することを確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { TripDay } from '../types.js';

let app: Hono;

beforeAll(async () => {
  await setupTestDb();
  const mod = await import('../app.js');
  app = mod.buildApiApp();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await sql`DELETE FROM route_legs`;
  await sql`DELETE FROM itinerary_items`;
  await sql`DELETE FROM trip_check_items`;
  await sql`DELETE FROM trip_days`;
  await sql`DELETE FROM trips`;
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('suggest adopt input validation', () => {
  it('不正な plan days は 400 になり、既存の予定と経路を一切消さない', async () => {
    const trip = await json<{ id: string }>(await post('/api/trips', {
      title: '採用検証',
      start_date: '2026-10-20',
      end_date: '2026-10-21',
    }));
    const [day] = (await sql`
      SELECT * FROM trip_days WHERE trip_id=${trip.id} ORDER BY day_index`) as TripDay[];
    expect(day).toBeDefined();

    await sql`INSERT INTO itinerary_items (id, day_id, order_index, planned_time, kind, note)
      VALUES (${newId()}, ${day!.id}, ${0}, ${'09:00'}, ${'note'}, ${'既存の予定'})`;
    await sql`INSERT INTO route_legs (id, day_id, mode)
      VALUES (${newId()}, ${day!.id}, ${'walking'})`;

    const validFirstDay = {
      day_index: 0,
      date: '2026-10-20',
      title: '置換案',
      note: null,
      travel_sec: 0,
      stay_sec: 0,
      items: [{
        kind: 'note',
        place_id: null,
        label: '新しい予定',
        planned_time: '10:00',
        note: null,
        mode: null,
        duration_sec: null,
        distance_m: null,
        duration_source: null,
      }],
    };
    const response = await post(`/api/trips/${trip.id}/plan/adopt`, {
      confirm: true,
      days: [validFirstDay, null],
    });
    expect(response.status).toBe(400);

    const items = (await sql`SELECT note FROM itinerary_items WHERE day_id=${day!.id}`) as Array<{ note: string }>;
    const legs = (await sql`SELECT id FROM route_legs WHERE day_id=${day!.id}`) as Array<{ id: string }>;
    expect(items.map((item) => item.note)).toEqual(['既存の予定']);
    expect(legs).toHaveLength(1);
  });

  it('不正な packing item は 400 になり、既存の持ち物を削除しない', async () => {
    const trip = await json<{ id: string }>(await post('/api/trips', { title: '荷物採用検証' }));
    const existingId = newId();
    await sql`INSERT INTO trip_check_items (id, trip_id, list_type, title, status, order_index)
      VALUES (${existingId}, ${trip.id}, ${'packing'}, ${'既存の荷物'}, ${'todo'}, ${0})`;

    const response = await post(`/api/trips/${trip.id}/packing/adopt`, {
      items: [null],
      remove_item_ids: [existingId],
    });
    expect(response.status).toBe(400);

    const rows = (await sql`
      SELECT id FROM trip_check_items WHERE trip_id=${trip.id}`) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual([existingId]);
  });
});
