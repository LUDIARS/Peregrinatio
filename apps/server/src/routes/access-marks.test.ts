// アクセス印の統合テスト。Google API キー未設定 (Places は呼ばない) の環境で、
// 拠点からのタクシー初乗り圏・GTFS が無いときに否定の印を出さないこと・設定 API を確かめる。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { readAccessCache, writeAccessCache } from '../access-marks/cache.js';
import type { AccessMarks } from '../access-marks/types.js';
import type { Trip, TripPlace } from '../types.js';

let app: Hono;

beforeAll(async () => {
  await setupTestDb();
  const mod = await import('../app.js');
  app = mod.buildApiApp();
});
afterAll(async () => {
  await teardownTestDb();
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function tripWithPlaces(): Promise<{ trip: Trip; near: TripPlace; far: TripPlace }> {
  const trip = await json<Trip>(await send('POST', '/api/trips', { title: '印' }));
  await send('POST', `/api/trips/${trip.id}/places`, { name: '宿', lat: 37.0, lng: 140.0, is_base: 1 });
  const near = await json<TripPlace>(await send('POST', `/api/trips/${trip.id}/places`, {
    name: '近くの店', lat: 37.005, lng: 140.0, notes: '宿から無料送迎バスあり',
  }));
  const far = await json<TripPlace>(await send('POST', `/api/trips/${trip.id}/places`, { name: '遠くの滝', lat: 37.2, lng: 140.0 }));
  return { trip, near, far };
}

describe('アクセス印', () => {
  it('旅の場所一覧に印が付き、付かない印はキーごと省く', async () => {
    const { trip, near, far } = await tripWithPlaces();
    const rows = await json<Array<TripPlace & { access_marks?: AccessMarks }>>(await send('GET', `/api/trips/${trip.id}/places`));
    const n = rows.find((r) => r.id === near.id)!;
    expect(n.access_marks?.taxi_first_fare).toMatchObject({ origin_kind: 'base', origin_name: '宿', threshold_m: 1200 });
    expect(n.access_marks?.shuttle_bus?.source).toBe('notes');
    expect(n.access_marks).not.toHaveProperty('bus_stop_near');
    const f = rows.find((r) => r.id === far.id)!;
    expect(f.access_marks).toEqual({});
    // 拠点そのものには付けない。
    expect(rows.find((r) => r.is_base === 1)).not.toHaveProperty('access_marks');

    const map = await json<Record<string, AccessMarks>>(await send('GET', `/api/trips/${trip.id}/access-marks`));
    expect(map[near.id]?.taxi_first_fare?.origin_kind).toBe('base');
  });

  it('初乗り距離を設定で変えると判定が変わる', async () => {
    const { trip, near } = await tripWithPlaces();
    expect((await send('PUT', '/api/settings/access-marks', { taxi_first_fare_m: 300 })).status).toBe(200);
    const map = await json<Record<string, AccessMarks>>(await send('GET', `/api/trips/${trip.id}/access-marks`));
    expect(map[near.id]?.taxi_first_fare).toBeUndefined();
    const reset = await json<{ taxi_first_fare_m: number }>(await send('DELETE', '/api/settings/access-marks'));
    expect(reset.taxi_first_fare_m).toBe(1200);
  });

  it('初乗り距離の不正値は 400', async () => {
    expect((await send('PUT', '/api/settings/access-marks', { taxi_first_fare_m: 50 })).status).toBe(400);
    expect((await send('PUT', '/api/settings/access-marks', { taxi_first_fare_m: '1200' })).status).toBe(400);
  });

  it('キャッシュは TTL を過ぎたら読まない (JSON の自動 decode にも耐える)', async () => {
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    await writeAccessCache('k1', 'bus_stop_places', { hit: null }, { now: () => t0 });
    expect(await readAccessCache('k1', 'bus_stop_places', 1000, { now: () => t0 + 10 })).toEqual({ hit: null });
    expect(await readAccessCache('k1', 'bus_stop_places', 1000, { now: () => t0 + 5000 })).toBeNull();
  });
});
