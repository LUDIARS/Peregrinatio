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

  it('「また今度」は旅ごと: 旅A で postponed=1 にしても旅B では 0 のまま', async () => {
    const tripA = await createTrip('旅A');
    const tripB = await createTrip('旅B');
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${tripA.id}/places`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'また今度の店' }),
      }),
    );
    // 旅B にも同じ場所を紐付け (使い回し)
    await app.request(`/api/trips/${tripB.id}/places`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: created.id }),
    });
    // 旅A だけ また今度 に
    const patched = await json<{ postponed: number }>(
      await app.request(`/api/trips/${tripA.id}/places/${created.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postponed: 1 }),
      }),
    );
    expect(patched.postponed).toBe(1);

    const aPlaces = await json<{ id: string; postponed: number }[]>(await app.request(`/api/trips/${tripA.id}/places`));
    const bPlaces = await json<{ id: string; postponed: number }[]>(await app.request(`/api/trips/${tripB.id}/places`));
    expect(aPlaces.find((p) => p.id === created.id)!.postponed).toBe(1); // 旅A は隔離
    expect(bPlaces.find((p) => p.id === created.id)!.postponed).toBe(0); // 旅B は通常 (旅データなので独立)
  });

  it('x-pe-user ヘッダで status_by (変更者の表示名) を記録する', async () => {
    const trip = await createTrip('旅A');
    const created = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '気になる候補' }),
      }),
    );
    const patched = await json<{ status: string; status_by: string | null }>(
      await app.request(`/api/places/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-pe-user': encodeURIComponent('たろう') },
        body: JSON.stringify({ status: 'interested' }),
      }),
    );
    expect(patched.status).toBe('interested');
    expect(patched.status_by).toBe('たろう'); // 誰が「気になる」にしたか
  });

  it('場所リストは「気になる」を先頭に並べる', async () => {
    const trip = await createTrip('旅A');
    // 通常追加 (status=none)
    await app.request(`/api/trips/${trip.id}/places`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '普通の場所' }),
    });
    // 後から追加して「気になる」に
    const fav = await json<{ id: string }>(
      await app.request(`/api/trips/${trip.id}/places`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '気になる場所' }),
      }),
    );
    await app.request(`/api/places/${fav.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'interested' }),
    });

    const list = await json<{ name: string }[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(list[0]!.name).toBe('気になる場所'); // interested が先頭
  });
});
