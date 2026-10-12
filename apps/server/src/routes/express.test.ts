// 新幹線・特急の時刻表ライブラリと往復便提案の統合テスト。
// Geocoding・LLM は叩かない (貼り付けの取り込みは駅座標を手で渡す・API キー未設定で warnings を確認する)。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import type { ExpressLineDetail, ExpressLineSummary, ExpressSuggestResult } from '../express/types.js';
import type { Timetable, TimetableDeparture, Trip, TripPlace } from '../types.js';

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

/** 東京の自宅 → 那須塩原の拠点の旅 (土曜〜日曜)。 */
async function nasuTrip(): Promise<Trip> {
  const trip = await json<Trip>(await send('POST', '/api/trips', { title: '那須', start_date: '2026-10-17', end_date: '2026-10-18' }));
  await sql`UPDATE trips SET origin_kind='home', origin_label='自宅', origin_lat=35.69, origin_lng=139.70 WHERE id=${trip.id}`;
  const base = await json<TripPlace>(await send('POST', `/api/trips/${trip.id}/places`, {
    name: '那須の宿', lat: 37.0, lng: 140.0, is_base: 1,
  }));
  await send('PATCH', `/api/trips/${trip.id}/places/${base.id}`, { checkin_time: '15:00', checkout_time: '10:00' });
  return trip;
}

describe('時刻表ライブラリ', () => {
  it('なすのの直書きは seed として路線ライブラリに入っている', async () => {
    const lines = await json<ExpressLineSummary[]>(await send('GET', '/api/express/lines'));
    const seed = lines.find((l) => l.id === 'seed-tohoku-shinkansen');
    expect(seed?.train_count).toBe(50);
    const detail = await json<ExpressLineDetail>(await send('GET', '/api/express/lines/seed-tohoku-shinkansen'));
    expect(detail.stations.map((s) => s.name)).toEqual(['東京', '那須塩原']);
  });

  it('旧なすの専用 API は無くなっている', async () => {
    const trip = await nasuTrip();
    const res = await send('POST', `/api/trips/${trip.id}/timetables/tohoku-shinkansen-seed`, {});
    expect(res.status).toBe(404);
  });

  it('貼り付けをプレビューしてから保存し、駅座標を手修正できる', async () => {
    const preview = await send('POST', '/api/express/import/preview', {
      mode: 'paste',
      line: { name: '特急ひたち', kind: 'limited_express' },
      tables: [{ direction: 'down', text: '駅\tひたち1号\n上野\t7:00\n水戸\t8:10\nいわき\t9:15' }],
    });
    expect(preview.status).toBe(200);
    const payload = await json<{ stations: Array<{ name: string; lat: number | null }>; warnings: string[] }>(preview);
    expect(payload.stations.map((s) => s.name)).toEqual(['上野', '水戸', 'いわき']);
    // テスト環境は Geocoding キー未設定。黙って飛ばさず warnings に出る。
    expect(payload.warnings.some((w) => w.includes('googleMaps.apiKey'))).toBe(true);

    const saved = await json<{ line: ExpressLineDetail }>(await send('POST', '/api/express/import', payload));
    expect(saved.line.trains).toHaveLength(1);

    const fixed = await send('PATCH', `/api/express/lines/${saved.line.id}/stations/1`, { lat: 36.37, lng: 140.48 });
    expect(fixed.status).toBe(200);
    expect((await json<{ lat: number }>(fixed)).lat).toBe(36.37);

    expect((await send('DELETE', `/api/express/lines/${saved.line.id}`)).status).toBe(200);
    expect((await send('GET', `/api/express/lines/${saved.line.id}`)).status).toBe(404);
  });

  it('保存できる列車が無い本文は 400', async () => {
    const res = await send('POST', '/api/express/import', {
      line: { name: 'x', kind: 'shinkansen' }, stations: [{ name: 'A' }, { name: 'B' }], trains: [],
    });
    expect(res.status).toBe(400);
  });
});

describe('往復便の提案と採用', () => {
  it('チェックインに間に合う往路と、チェックアウト後の復路を提案する (GTFS 無し → タクシー概算)', async () => {
    const trip = await nasuTrip();
    const r = await json<ExpressSuggestResult>(await send('POST', `/api/trips/${trip.id}/express/suggest`, {}));
    expect(r.outbound.length).toBeGreaterThan(0);
    expect(r.outbound[0]?.board_station).toBe('東京');
    expect(r.outbound[0]?.terminal.source).toBe('estimate');
    expect(r.outbound[0]!.terminal.arrive_time <= '15:00').toBe(true);
    expect(r.inbound[0]!.depart_time >= '10:00').toBe(true);
    // seed は 2022 年改正。旅の日付から 1 年以上前なのでダイヤ改正の警告が出る。
    expect(r.warnings.some((w) => w.includes('ダイヤ改正'))).toBe(true);
  });

  it('出発地点が無ければ候補を出さず理由を返す', async () => {
    const trip = await nasuTrip();
    await sql`UPDATE trips SET origin_kind='none', origin_lat=NULL, origin_lng=NULL WHERE id=${trip.id}`;
    const r = await json<ExpressSuggestResult>(await send('POST', `/api/trips/${trip.id}/express/suggest`, {}));
    expect(r.outbound).toEqual([]);
    expect(r.warnings[0]).toContain('出発地点');
  });

  it('採用した便を旅の区間ボードへ写し、同じ便は 1 行にまとめる', async () => {
    const trip = await nasuTrip();
    const r = await json<ExpressSuggestResult>(await send('POST', `/api/trips/${trip.id}/express/suggest`, {}));
    const o = r.outbound[0]!;
    const body = { train_id: o.train_id, from_seq: o.board_seq, to_seq: o.alight_seq };
    const first = await json<{ timetable: Timetable; departure: TimetableDeparture }>(
      await send('POST', `/api/trips/${trip.id}/express/adopt`, body));
    expect(first.timetable.from_station).toBe('東京');
    expect(first.departure.depart_time).toBe(o.depart_time);
    await send('POST', `/api/trips/${trip.id}/express/adopt`, body);
    const deps = (await sql`SELECT id FROM timetable_departures WHERE timetable_id=${first.timetable.id}`) as unknown[];
    expect(deps).toHaveLength(1);

    const reversed = await send('POST', `/api/trips/${trip.id}/express/adopt`, { ...body, from_seq: o.alight_seq, to_seq: o.board_seq });
    expect(reversed.status).toBe(400);
  });

  it('プラン提案の往路・復路が別手配メモから便の行に替わる', async () => {
    const trip = await nasuTrip();
    const res = await send('POST', `/api/trips/${trip.id}/plan/suggest`, { use_llm: false, primary_mode: 'driving' });
    const plan = await json<{ days: Array<{ items: Array<{ duration_source: string | null; note: string | null }> }>; express: { selected_outbound: number | null } | null }>(res);
    expect(plan.express?.selected_outbound).toBe(0);
    const first = plan.days[0]!.items;
    expect(first.some((i) => i.duration_source === 'express_timetable')).toBe(true);
    expect(first.some((i) => i.note?.includes('別手配'))).toBe(false);
    const last = plan.days[plan.days.length - 1]!.items;
    expect(last.some((i) => i.duration_source === 'express_timetable')).toBe(true);
  });

  it('乗車駅→降車駅で乗れる便を時刻以降で引ける', async () => {
    const res = await send('GET', '/api/express/lines/seed-tohoku-shinkansen/segments?from_seq=0&to_seq=1&date=2026-10-17&after=21:00');
    const rows = await json<Array<{ depart_time: string }>>(res);
    expect(rows.map((r) => r.depart_time)).toEqual(['21:24', '22:00', '22:44']);
  });
});
