// 自動検索 / 地図 POI 追加ルートの統合テスト。
// Google を呼ばずに検証できる範囲を固定する:
//   - 入力検証 (place_id 必須)
//   - 既存 Google place id の場所は Google 呼び出しなしで再利用される (重複防止 + オフライン可)
//   - API キー未設定時は silent fallback せず明示エラーを返す ([[feedback_no_silent_fallback]])

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';

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
  await sql`DELETE FROM place_links`;
  await sql`DELETE FROM places`;
  await sql`DELETE FROM trips`;
  config.googleMaps.apiKey = ''; // テストは外部 API を叩かない (キー未設定が既定)
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

/** ライブラリに google_place_id 付きの場所を直接 seed する。 */
async function seedPlace(name: string, gpid: string): Promise<string> {
  const id = newId();
  const now = nowIso();
  await sql`INSERT INTO places (id, name, status, google_place_id, created_at, updated_at)
    VALUES (${id}, ${name}, 'none', ${gpid}, ${now}, ${now})`;
  return id;
}

describe('from-google (地図 POI からの追加)', () => {
  it('place_id が無ければ 400', async () => {
    const trip = await createTrip('旅A');
    const res = await app.request(`/api/trips/${trip.id}/places/from-google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('既存の Google place id の場所は Google を呼ばず再利用して旅に紐付ける', async () => {
    const trip = await createTrip('旅A');
    const placeId = await seedPlace('既存スポット', 'ChIJ_existing');

    const res = await app.request(`/api/trips/${trip.id}/places/from-google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: 'ChIJ_existing' }),
    });
    // API キー未設定でも、既存再利用パスは Google を呼ばないので成功する。
    expect(res.status).toBe(200);
    const out = await json<{ place: { id: string; name: string } }>(res);
    expect(out.place.id).toBe(placeId);
    expect(out.place.name).toBe('既存スポット');

    // 旅に 1 件だけ紐付き、ライブラリは重複作成されない。
    const lib = await json<unknown[]>(await app.request('/api/places'));
    expect(lib).toHaveLength(1);
    const places = await json<unknown[]>(await app.request(`/api/trips/${trip.id}/places`));
    expect(places).toHaveLength(1);
  });

  it('新規 POI で API キー未設定なら 400 (silent fallback しない)', async () => {
    const trip = await createTrip('旅A');
    const res = await app.request(`/api/trips/${trip.id}/places/from-google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place_id: 'ChIJ_new_unknown' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('auto-search (既存場所の自動補完)', () => {
  it('API キー未設定なら 502 (silent fallback せずエラーを surface)', async () => {
    const trip = await createTrip('旅A');
    const placeId = await seedPlace('名前あり場所', 'ChIJ_x');
    await sql`INSERT INTO trip_places (trip_id, place_id, is_base, added_at)
      VALUES (${trip.id}, ${placeId}, 0, ${nowIso()})`;

    const res = await app.request(`/api/trips/${trip.id}/places/${placeId}/auto-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(502);
  });
});
