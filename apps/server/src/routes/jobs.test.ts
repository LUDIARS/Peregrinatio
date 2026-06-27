// 取り込みキュー (place_jobs) の統合テスト。
// worker は走らせず、ジョブ状態を SQL で手動遷移させて「ドラフト隠し」「破棄で掃除」の契約を固定する。

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
  await sql`DELETE FROM place_jobs`;
  await sql`DELETE FROM trip_places`;
  await sql`DELETE FROM places`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createTrip(title: string): Promise<{ id: string }> {
  return json(await app.request('/api/trips', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
  }));
}

async function addPlace(tripId: string, body: Record<string, unknown>): Promise<{ id: string }> {
  return json(await app.request(`/api/trips/${tripId}/places`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('取り込みキュー (place_jobs)', () => {
  it('ジョブを積むと pending で作られる', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: 'ドラフト' });
    const res = await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'image', is_new_place: 1 }),
    });
    expect(res.status).toBe(200);
    const job = await json<{ status: string; kind: string }>(res);
    expect(job.status).toBe('pending');
    expect(job.kind).toBe('image');
  });

  it('crawl は source_url 必須 (400)', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: 'x' });
    const res = await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'crawl' }),
    });
    expect(res.status).toBe(400);
  });

  it('新規ドラフト (is_new_place=1) はジョブ進行中は一覧に出ず、done で出る', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: '画像から取り込み中…' });
    const job = await json<{ id: string }>(await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'image', is_new_place: 1 }),
    }));

    // pending の間は一覧に出ない (ドラフト隠し)
    let list = await json<{ id: string }[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(list.find((p) => p.id === place.id)).toBeUndefined();

    // worker 相当: 座標が付いて done になったとする
    await sql`UPDATE places SET lat=35.0, lng=139.0 WHERE id=${place.id}`;
    await sql`UPDATE place_jobs SET status='done' WHERE id=${job.id}`;

    list = await json<{ id: string }[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(list.find((p) => p.id === place.id)).toBeDefined(); // 成立したので一覧に昇格
  });

  it('既存場所の追加取り込み (is_new_place=0) は進行中でも一覧から消えない', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: '既存', lat: 35.0, lng: 139.0 });
    await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'crawl', source_url: 'https://example.com', is_new_place: 0 }),
    });
    const list = await json<{ id: string }[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(list.find((p) => p.id === place.id)).toBeDefined();
  });

  it('未成立ドラフトのジョブを破棄すると place ごと掃除される', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: 'ゴミ' });
    const job = await json<{ id: string }>(await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'image', is_new_place: 1 }),
    }));
    await sql`UPDATE place_jobs SET status='needs_info', missing_info='地図上の位置' WHERE id=${job.id}`;

    const del = await app.request(`/api/jobs/${job.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(0); // ドラフト place も消えている
  });

  it('再試行で pending に戻り、不足情報/エラーがクリアされる', async () => {
    const trip = await createTrip('旅A');
    const place = await addPlace(trip.id, { name: 'x' });
    const job = await json<{ id: string }>(await app.request(`/api/trips/${trip.id}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: place.id, kind: 'image', is_new_place: 1 }),
    }));
    await sql`UPDATE place_jobs SET status='failed', error='boom' WHERE id=${job.id}`;

    const retried = await json<{ status: string; error: string | null }>(
      await app.request(`/api/jobs/${job.id}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    expect(retried.status).toBe('pending');
    expect(retried.error).toBeNull();
  });
});
