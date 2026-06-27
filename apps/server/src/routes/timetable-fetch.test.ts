// fetch/refresh の DB 反映を、プロバイダを差し替えて (network/CLI を避けて) 検証する。
// transit/index.js の resolveProvider をモックし、固定の抽出結果を返させる。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';

// resolveProvider を、両対応の固定プロバイダを返すモックに差し替える。
vi.mock('../transit/index.js', () => ({
  resolveProvider: () => ({
    kind: 'crawl-llm',
    supportsDepartures: true,
    supportsAlerts: true,
    fetchDepartures: async () => [
      { depart_time: '08:00', arrive_time: '10:30', train_name: 'かがやき', platform: '14', fare_text: '¥14380', note: null },
      { depart_time: '09:12', arrive_time: '11:40', train_name: 'はくたか', platform: null, fare_text: null, note: null },
    ],
    fetchAlerts: async () => [
      { line_name: '北陸新幹線', severity: 'warning', title: '遅延', body: '大雪', source_url: 'https://x' },
    ],
  }),
}));

import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import type { ServiceAlert, Timetable, TimetableDeparture } from '../types.js';

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
  await sql`DELETE FROM service_alerts`;
  await sql`DELETE FROM timetable_departures`;
  await sql`DELETE FROM timetables`;
  await sql`DELETE FROM trips`;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('時刻表 fetch (プロバイダ差し替え)', () => {
  it('抽出した便を timetable_departures へ挿入する', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const tt = await json<Timetable>(
      await post(`/api/trips/${t.id}/timetables`, { kind: 'shinkansen', from_station: '東京', to_station: '金沢' }),
    );
    const res = await post(`/api/timetables/${tt.id}/fetch`, { url: 'https://example.com/tt' });
    expect(res.status).toBe(200);
    const body = await json<{ provider: string; added: number; departures: TimetableDeparture[] }>(res);
    expect(body.added).toBe(2);
    expect(body.departures).toHaveLength(2);
    expect(body.departures[0]?.train_name).toBe('かがやき');
  });

  it('既存の手入力便の後ろに連番 order_index で追加する', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const tt = await json<Timetable>(await post(`/api/trips/${t.id}/timetables`, { kind: 'train' }));
    await post(`/api/timetables/${tt.id}/departures`, { depart_time: '06:00', train_name: '手入力' });

    await post(`/api/timetables/${tt.id}/fetch`, { url: 'https://example.com/tt' });

    const rows = (await sql`
      SELECT * FROM timetable_departures WHERE timetable_id=${tt.id} ORDER BY order_index`) as TimetableDeparture[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.order_index)).toEqual([0, 1, 2]);
    expect(rows[0]?.train_name).toBe('手入力');
  });
});

describe('運行情報 refresh (プロバイダ差し替え)', () => {
  it('抽出した運行情報を service_alerts へ挿入し fetched_at を入れる', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const res = await post(`/api/trips/${t.id}/service-alerts/refresh`, { url: 'https://example.com/info' });
    expect(res.status).toBe(200);
    const body = await json<{ added: number; alerts: ServiceAlert[] }>(res);
    expect(body.added).toBe(1);
    expect(body.alerts[0]?.severity).toBe('warning');
    expect(body.alerts[0]?.fetched_at).not.toBeNull();
  });
});
