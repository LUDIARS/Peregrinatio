// 出発地点 (origin) と自宅設定の統合テスト (ジオコーディングを伴わない経路のみ)。
// meeting/home の座標解決は Google API を叩くため、ここでは未設定エラー/クリア/既定値を検証する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import type { Trip } from '../types.js';

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
  await sql`DELETE FROM app_settings`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
function send(method: string, path: string, body: unknown) {
  return app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('出発地点 origin', () => {
  it('新規の旅は origin_kind=none', async () => {
    const t = await json<Trip>(await send('POST', '/api/trips', { title: '旅' }));
    expect(t.origin_kind).toBe('none');
    expect(t.origin_lat).toBeNull();
  });

  it('kind=none で出発地点をクリアできる', async () => {
    const t = await json<Trip>(await send('POST', '/api/trips', { title: '旅' }));
    const res = await send('PUT', `/api/trips/${t.id}/origin`, { kind: 'none' });
    expect(res.status).toBe(200);
    const tt = await json<Trip>(res);
    expect(tt.origin_kind).toBe('none');
    expect(tt.origin_label).toBeNull();
  });

  it('自宅未設定で kind=home は 400 (silent fallback しない)', async () => {
    const t = await json<Trip>(await send('POST', '/api/trips', { title: '旅' }));
    const res = await send('PUT', `/api/trips/${t.id}/origin`, { kind: 'home' });
    expect(res.status).toBe(400);
  });

  it('kind=meeting で住所未指定は 400', async () => {
    const t = await json<Trip>(await send('POST', '/api/trips', { title: '旅' }));
    const res = await send('PUT', `/api/trips/${t.id}/origin`, { kind: 'meeting' });
    expect(res.status).toBe(400);
  });

  it('存在しない旅への origin は 404', async () => {
    const res = await send('PUT', '/api/trips/nope/origin', { kind: 'none' });
    expect(res.status).toBe(404);
  });

  it('GET /api/settings/home は初期 null / 住所未指定 PUT は 400', async () => {
    expect(await json(await app.request('/api/settings/home'))).toBeNull();
    const res = await send('PUT', '/api/settings/home', {});
    expect(res.status).toBe(400);
  });
});
