// 場所ライブラリ (全旅共有) と旅↔場所メンバーシップの統合テスト。
// 特に #5「既存ライブラリ場所の使い回し」= place_id 指定で別の旅に同じ場所を紐付けられること、
// 旅から外しても場所はライブラリに残ること、を回帰として固定する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';

let app: Hono;

beforeAll(async () => {
  await setupTestDb();
  // app は DB 初期化後に生成する (route は遅延ラッパー経由で sql を掴むので順序自体は緩いが、
  // 初期化前に request すると getImpl() が throw するため明示的に後で組む)。
  const mod = await import('../app.js');
  app = mod.buildApiApp();
});

afterAll(async () => {
  await teardownTestDb();
});

// 各テストは独立させる: trip_places / places を空にする。
beforeEach(async () => {
  await sql`DELETE FROM trip_places`;
  await sql`DELETE FROM places`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createTrip(title: string): Promise<{ id: string }> {
  const res = await app.request('/api/trips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(200);
  return json(res);
}

describe('places library + trip membership', () => {
  it('新規場所を旅に追加するとライブラリにも 1 件入る', async () => {
    const trip = await createTrip('旅A');
    const res = await app.request(`/api/trips/${trip.id}/places`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '東京タワー', lat: 35.6586, lng: 139.7454 }),
    });
    expect(res.status).toBe(200);
    const tp = await json<{ id: string; name: string; is_base: number }>(res);
    expect(tp.name).toBe('東京タワー');
    expect(tp.is_base).toBe(0);

    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(1);
  });

  it('#5 既存ライブラリ場所を place_id で別の旅にも紐付けられる (場所は重複しない)', async () => {
    const tripA = await createTrip('旅A');
    const tripB = await createTrip('旅B');

    // 旅A に新規場所
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${tripA.id}/places`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '金沢21世紀美術館' }),
      }),
    );

    // 旅B に「既存場所」を place_id で紐付け (= 使い回し)
    const reuse = await app.request(`/api/trips/${tripB.id}/places`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: created.id }),
    });
    expect(reuse.status).toBe(200);
    const tpB = await json<{ id: string }>(reuse);
    expect(tpB.id).toBe(created.id); // 同じ place が両方の旅にいる

    // ライブラリは依然 1 件 (重複生成していない)
    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(1);

    // 両方の旅に同一場所が membership として見える
    const aPlaces = await json<{ id: string }[]>(await app.request(`/api/trips/${tripA.id}/places`));
    const bPlaces = await json<{ id: string }[]>(await app.request(`/api/trips/${tripB.id}/places`));
    expect(aPlaces.map((p) => p.id)).toContain(created.id);
    expect(bPlaces.map((p) => p.id)).toContain(created.id);
  });

  it('同じ場所を同じ旅に二重追加しても membership は 1 件 (INSERT OR IGNORE)', async () => {
    const trip = await createTrip('旅A');
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ひがし茶屋街' }),
      }),
    );
    await app.request(`/api/trips/${trip.id}/places`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: created.id }),
    });
    const places = await json<unknown[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(places).toHaveLength(1);
  });

  it('旅から外しても場所はライブラリに残る (恒久ライブラリ)', async () => {
    const trip = await createTrip('旅A');
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '兼六園' }),
      }),
    );
    const del = await app.request(`/api/trips/${trip.id}/places/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const tripPlaces = await json<unknown[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(tripPlaces).toHaveLength(0); // この旅からは消えた

    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(1); // ライブラリには残る
  });

  it('?status / ?q でライブラリを絞り込める', async () => {
    const trip = await createTrip('旅A');
    const a = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'アルパカ牧場' }),
      }),
    );
    await app.request(`/api/trips/${trip.id}/places`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '美術館' }),
    });
    // a を visited に
    await app.request(`/api/places/${a.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'visited' }),
    });

    const visited = await json<unknown[]>(await app.request('/api/places?status=visited'));
    expect(visited).toHaveLength(1);

    const q = await json<{ name: string }[]>(await app.request('/api/places?q=' + encodeURIComponent('美術館')));
    expect(q).toHaveLength(1);
    expect(q[0]!.name).toBe('美術館');
  });

  it('is_base を切り替えられる (メンバーシップ単位)', async () => {
    const trip = await createTrip('旅A');
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ホテル' }),
      }),
    );
    const patched = await json<{ is_base: number }>(
      await app.request(`/api/trips/${trip.id}/places/${created.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_base: 1 }),
      }),
    );
    expect(patched.is_base).toBe(1);
  });
});
