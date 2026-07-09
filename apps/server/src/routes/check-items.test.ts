// 旅の準備チェックリスト (持ち物 / TODO) の統合テスト。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import type { TripCheckItem } from '../types.js';

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
  await sql`DELETE FROM trip_check_items`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createTrip(title: string): Promise<{ id: string }> {
  return json(await app.request('/api/trips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  }));
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('trip check items', () => {
  it('持ち物と TODO を作成し、list_type で絞り込める', async () => {
    const trip = await createTrip('準備する旅');

    const packingRes = await post(`/api/trips/${trip.id}/check-items`, {
      list_type: 'packing',
      title: '充電器',
      quantity: 2,
      category: '電子機器',
    });
    expect(packingRes.status).toBe(201);
    const packing = await json<TripCheckItem>(packingRes);
    expect(packing.list_type).toBe('packing');
    expect(packing.quantity).toBe(2);

    await post(`/api/trips/${trip.id}/check-items`, {
      list_type: 'todo',
      title: '新幹線を予約',
      due_at: '2026-07-10T18:00',
    });

    const all = await json<TripCheckItem[]>(await app.request(`/api/trips/${trip.id}/check-items`));
    expect(all).toHaveLength(2);

    const onlyPacking = await json<TripCheckItem[]>(
      await app.request(`/api/trips/${trip.id}/check-items?list_type=packing`),
    );
    expect(onlyPacking).toHaveLength(1);
    expect(onlyPacking[0]!.title).toBe('充電器');
  });

  it('タイトル無しと不正な list_type は 400', async () => {
    const trip = await createTrip('準備する旅');

    const missingTitle = await post(`/api/trips/${trip.id}/check-items`, { list_type: 'todo' });
    expect(missingTitle.status).toBe(400);

    const invalidListType = await app.request(`/api/trips/${trip.id}/check-items?list_type=other`);
    expect(invalidListType.status).toBe(400);
  });

  it('状態更新と削除ができる', async () => {
    const trip = await createTrip('準備する旅');
    const item = await json<TripCheckItem>(await post(`/api/trips/${trip.id}/check-items`, {
      list_type: 'todo',
      title: '荷物を発送',
    }));

    const patched = await json<TripCheckItem>(await app.request(`/api/check-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', details: '前日午前まで' }),
    }));
    expect(patched.status).toBe('done');
    expect(patched.details).toBe('前日午前まで');

    const del = await app.request(`/api/check-items/${item.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await json<TripCheckItem[]>(await app.request(`/api/trips/${trip.id}/check-items`));
    expect(after).toEqual([]);
  });
});
