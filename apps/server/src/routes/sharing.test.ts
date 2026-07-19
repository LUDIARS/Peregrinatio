import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { sql } from '../db/index.js';
import { setupTestDb, teardownTestDb } from '../test/db.js';

let app: Hono;

beforeAll(async () => {
  await setupTestDb();
  app = (await import('../app.js')).buildApiApp();
});

afterAll(teardownTestDb);

beforeEach(async () => {
  await sql`DELETE FROM trips`;
});

async function createTrip(): Promise<string> {
  const response = await app.request('/api/trips', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '共有する旅' }),
  });
  return ((await response.json()) as { id: string }).id;
}

describe('trip sharing', () => {
  it('合言葉なしの共有リンクから最小限の旅情報を取得できる', async () => {
    const tripId = await createTrip();
    const configured = await app.request(`/api/trips/${tripId}/share`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: null }),
    });
    const share = (await configured.json()) as { token: string; password_protected: boolean };
    expect(share.password_protected).toBe(false);

    const opened = await app.request(`/api/shares/${share.token}`);
    expect(opened.status).toBe(200);
    const body = (await opened.json()) as { trip: { trip_id: string; title: string } };
    expect(body.trip).toEqual(expect.objectContaining({ trip_id: tripId, title: '共有する旅' }));
  });

  it('合言葉は平文保存せず、正しい入力だけを許可する', async () => {
    const tripId = await createTrip();
    const configured = await app.request(`/api/trips/${tripId}/share`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'ねこの合言葉' }),
    });
    const share = (await configured.json()) as { token: string; password_protected: boolean };
    expect(share.password_protected).toBe(true);

    const [stored] = (await sql`SELECT password_salt, password_hash FROM trip_shares WHERE trip_id=${tripId}`) as {
      password_salt: string; password_hash: string;
    }[];
    expect(stored).toBeDefined();
    expect(stored!.password_hash).not.toContain('ねこの合言葉');
    expect(stored!.password_salt).toBeTruthy();

    const hidden = (await (await app.request(`/api/shares/${share.token}`)).json()) as Record<string, unknown>;
    expect(hidden.trip).toBeUndefined();
    const rejected = await app.request(`/api/shares/${share.token}/unlock`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '違う' }),
    });
    expect(rejected.status).toBe(401);
    const accepted = await app.request(`/api/shares/${share.token}/unlock`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'ねこの合言葉' }),
    });
    expect(accepted.status).toBe(200);
  });
});
