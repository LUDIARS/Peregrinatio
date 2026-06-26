// 旅 (trip) のライフサイクル統合テスト: 作成 / 一覧 / 取得 / 編集 / アーカイブ(2段階削除) / 削除。
// 旅を削除しても場所はライブラリに残る点 (恒久ライブラリ) も確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';

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
  await sql`DELETE FROM trip_places`;
  await sql`DELETE FROM places`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('trips lifecycle', () => {
  it('title 無しは 400', async () => {
    const res = await post('/api/trips', {});
    expect(res.status).toBe(400);
  });

  it('作成 → 一覧 → 取得 (TripDetail 形)', async () => {
    const created = await json<{ id: string; title: string; archived: number }>(
      await post('/api/trips', { title: '北陸旅行', start_date: '2026-07-01' }),
    );
    expect(created.title).toBe('北陸旅行');
    expect(created.archived).toBe(0);

    const list = await json<unknown[]>(await app.request('/api/trips'));
    expect(list).toHaveLength(1);

    const detail = await json<{ trip: { id: string }; days: unknown[]; places: unknown[] }>(
      await app.request(`/api/trips/${created.id}`),
    );
    expect(detail.trip.id).toBe(created.id);
    expect(detail.days).toEqual([]);
    expect(detail.places).toEqual([]);
  });

  it('存在しない旅の取得は 404', async () => {
    const res = await app.request('/api/trips/nope');
    expect(res.status).toBe(404);
  });

  it('PATCH でアーカイブ → 完全削除の2段階', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '京都' }));
    const archived = await json<{ archived: number }>(
      await app.request(`/api/trips/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: 1 }),
      }),
    );
    expect(archived.archived).toBe(1);

    const del = await app.request(`/api/trips/${t.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await json<unknown[]>(await app.request('/api/trips'))).toHaveLength(0);
  });

  it('旅を削除しても場所はライブラリに残る', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    await post(`/api/trips/${t.id}/places`, { name: '白川郷' });

    await app.request(`/api/trips/${t.id}`, { method: 'DELETE' });

    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(1);
  });
});
