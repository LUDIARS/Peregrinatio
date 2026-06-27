// 日程自動生成 / 拠点ホテル IN・OUT / 時刻表 / 運行情報 の統合テスト。
// 使い捨て SQLite + 本番 migration (006/007 を含む) 上で app.request() する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TripDay, TripPlace } from '../types.js';

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
  await sql`DELETE FROM trip_places`;
  await sql`DELETE FROM places`;
  await sql`DELETE FROM trip_days`;
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
function patch(path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('日程の自動決定', () => {
  it('開始日と終了日があれば trip_days を日付つきで自動生成する', async () => {
    const t = await json<{ id: string }>(
      await post('/api/trips', { title: '北陸', start_date: '2026-07-01', end_date: '2026-07-03' }),
    );
    const days = await json<TripDay[]>(await app.request(`/api/trips/${t.id}/days`));
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(days.map((d) => d.day_index)).toEqual([0, 1, 2]);
  });

  it('日付が無ければ日は自動生成しない', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '未定旅' }));
    const days = await json<TripDay[]>(await app.request(`/api/trips/${t.id}/days`));
    expect(days).toHaveLength(0);
  });
});

describe('拠点ホテルの IN/OUT', () => {
  it('trip_places PATCH で checkin/checkout を保存できる', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const p = await json<TripPlace>(await post(`/api/trips/${t.id}/places`, { name: 'ホテル', is_base: 1 }));
    const updated = await json<TripPlace>(
      await patch(`/api/trips/${t.id}/places/${p.id}`, { checkin_time: '15:00', checkout_time: '10:00' }),
    );
    expect(updated.checkin_time).toBe('15:00');
    expect(updated.checkout_time).toBe('10:00');

    // TripDetail にも反映される。
    const detail = await json<{ places: TripPlace[] }>(await app.request(`/api/trips/${t.id}`));
    expect(detail.places[0]?.checkin_time).toBe('15:00');
  });
});

describe('時刻表 / 運行情報', () => {
  it('時刻表と便を手入力で作成・取得できる', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const tt = await json<Timetable>(
      await post(`/api/trips/${t.id}/timetables`, { kind: 'shinkansen', from_station: '東京', to_station: '金沢' }),
    );
    expect(tt.kind).toBe('shinkansen');

    await post(`/api/timetables/${tt.id}/departures`, { depart_time: '08:00', arrive_time: '10:30', train_name: 'かがやき' });
    const deps = await json<TimetableDeparture[]>(await app.request(`/api/timetables/${tt.id}/departures`));
    expect(deps).toHaveLength(1);
    expect(deps[0]?.train_name).toBe('かがやき');

    const list = await json<Timetable[]>(await app.request(`/api/trips/${t.id}/timetables`));
    expect(list).toHaveLength(1);
  });

  it('自動取得 fetch はデータ源未配線で 501 を返す (握り潰さない)', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const tt = await json<Timetable>(await post(`/api/trips/${t.id}/timetables`, { kind: 'train' }));
    const res = await post(`/api/timetables/${tt.id}/fetch`, {});
    expect(res.status).toBe(501);
  });

  it('運行情報を手入力で作成・一覧できる', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    await post(`/api/trips/${t.id}/service-alerts`, { line_name: '北陸新幹線', severity: 'warning', title: '遅延' });
    const alerts = await json<ServiceAlert[]>(await app.request(`/api/trips/${t.id}/service-alerts`));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('warning');

    const refresh = await post(`/api/trips/${t.id}/service-alerts/refresh`, {});
    expect(refresh.status).toBe(501);
  });

  it('旅を削除すると時刻表/運行情報も連鎖削除される', async () => {
    const t = await json<{ id: string }>(await post('/api/trips', { title: '旅' }));
    const tt = await json<Timetable>(await post(`/api/trips/${t.id}/timetables`, { kind: 'bus' }));
    await post(`/api/timetables/${tt.id}/departures`, { depart_time: '09:00' });
    await post(`/api/trips/${t.id}/service-alerts`, { title: 'x' });

    await app.request(`/api/trips/${t.id}`, { method: 'DELETE' });

    const ttRows = (await sql`SELECT id FROM timetables`) as { id: string }[];
    const depRows = (await sql`SELECT id FROM timetable_departures`) as { id: string }[];
    const alertRows = (await sql`SELECT id FROM service_alerts`) as { id: string }[];
    expect(ttRows).toHaveLength(0);
    expect(depRows).toHaveLength(0);
    expect(alertRows).toHaveLength(0);
  });
});
