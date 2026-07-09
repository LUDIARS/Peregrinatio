// GTFS の近傍停留所/発車ボードのクエリを、ネットワーク無しで seed して検証する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import { nearbyStops, stopDepartures, listRoutes, routeTimetable, feedStops, findStopConnections, listRouteSummaries, searchRouteGraph } from './gtfs-query.js';

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });

beforeEach(async () => {
  for (const t of ['gtfs_stop_times', 'gtfs_trips', 'gtfs_routes', 'gtfs_stops', 'gtfs_calendar', 'gtfs_calendar_dates', 'gtfs_feeds']) {
    await sql.unsafe(`DELETE FROM ${t}`);
  }
  await sql`INSERT INTO gtfs_feeds (id, name, source_url, imported_at, stop_count, trip_count) VALUES ('F1','テストバス',NULL,'2026-06-29',2,3)`;
  await sql`INSERT INTO gtfs_stops (feed_id, stop_id, stop_name, lat, lng) VALUES
    ('F1','S_NEAR','駅前',35.681,139.767), ('F1','S_FAR','遠い',35.0,139.0),
    ('F1','S2','二番',35.60,139.60), ('F1','S3','三番',35.50,139.50)`;
  await sql`INSERT INTO gtfs_routes (feed_id, route_id, short_name, long_name, route_type) VALUES ('F1','R1','0001','循環線',3)`;
  await sql`INSERT INTO gtfs_trips (feed_id, trip_id, route_id, service_id, headsign, direction_id) VALUES
    ('F1','T1','R1','S_ALL','東京駅',0),
    ('F1','T2','R1','S_NONE','東京駅',0),
    ('F1','T3','R1','S_ALL','東京駅',0)`;
  // T1/T3 は S_NEAR→S2→S3 の 3 停留所パターン、T2 は S_NEAR のみの別パターン。
  await sql`INSERT INTO gtfs_stop_times (feed_id, trip_id, stop_id, stop_sequence, departure_time, arrive_time) VALUES
    ('F1','T1','S_NEAR',1,'08:00:00','08:00:00'),
    ('F1','T1','S2',2,'08:10:00','08:10:00'),
    ('F1','T1','S3',3,'08:20:00','08:20:00'),
    ('F1','T2','S_NEAR',1,'08:05:00','08:05:00'),
    ('F1','T3','S_NEAR',1,'07:00:00','07:00:00'),
    ('F1','T3','S2',2,'07:10:00','07:10:00'),
    ('F1','T3','S3',3,'07:20:00','07:20:00')`;
  await sql`INSERT INTO gtfs_calendar (feed_id, service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES
    ('F1','S_ALL',1,1,1,1,1,1,1,'20260101','20261231'),
    ('F1','S_NONE',0,0,0,0,0,0,0,'20260101','20261231')`;
  await sql`INSERT INTO gtfs_calendar_dates (feed_id, service_id, date, exception_type) VALUES ('F1','S_ALL','20260630',2)`;
});

describe('nearbyStops', () => {
  it('近い停留所だけ距離順で返す', async () => {
    const hits = await nearbyStops(35.681, 139.767, 500, 8);
    expect(hits.map((h) => h.stop_id)).toEqual(['S_NEAR']);
    expect(hits[0]!.feed_name).toBe('テストバス');
  });
});

describe('stopDepartures', () => {
  it('運行日・after 以降・運行service だけ返す', async () => {
    // 07:30 以降 → 07:00(T3)除外。S_NONE(T2)除外。残るは T1 の 08:00 のみ。
    const deps = await stopDepartures('F1', 'S_NEAR', '20260629', '07:30:00', 12);
    expect(deps.map((d) => d.departure_time)).toEqual(['08:00:00']);
    expect(deps[0]!.route_name).toBe('0001');
    expect(deps[0]!.headsign).toBe('東京駅');
  });

  it('calendar_dates の運休日は空', async () => {
    const deps = await stopDepartures('F1', 'S_NEAR', '20260630', '00:00:00', 12);
    expect(deps).toEqual([]);
  });
});

describe('listRoutes / routeTimetable', () => {
  it('路線一覧は便数つき', async () => {
    const rs = await listRoutes('F1');
    expect(rs).toHaveLength(1);
    expect(rs[0]!.route_id).toBe('R1');
    expect(rs[0]!.trip_count).toBe(3);
  });

  it('指定日に走る便だけで、停車順が同じ便を 1 パターンに (列=停留所/縦=時刻順)', async () => {
    // 平日 20260629: S_ALL(毎日) のみ運行、S_NONE(=T2) は走らない → 3 停留所パターン(T3,T1)のみ。
    const { patterns } = await routeTimetable('F1', 'R1', '20260629');
    expect(patterns).toHaveLength(1);
    const main = patterns[0]!;
    expect(main.stops.map((s) => s.stop_id)).toEqual(['S_NEAR', 'S2', 'S3']);
    expect(main.trips.map((t) => t.times[0])).toEqual(['07:00:00', '08:00:00']); // 早い順
    expect(main.trips[0]!.times).toEqual(['07:00:00', '07:10:00', '07:20:00']);
  });

  it('calendar_dates の運休日は便が無い', async () => {
    const { patterns } = await routeTimetable('F1', 'R1', '20260630'); // S_ALL 運休
    expect(patterns).toHaveLength(0);
  });

  it('feedStops は座標つき停留所を全部返す', async () => {
    const stops = await feedStops('F1');
    // S_NEAR/S_FAR/S2/S3 すべて座標あり。
    expect(stops.map((s) => s.stop_id).sort()).toEqual(['S2', 'S3', 'S_FAR', 'S_NEAR']);
  });

  it('取込済み路線の横断一覧はダイヤ種別の便数を返す', async () => {
    const rows = await listRouteSummaries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      feed_id: 'F1',
      route_id: 'R1',
      route_label: '0001 循環線',
      weekday_trip_count: 2,
      weekend_trip_count: 2,
      holiday_trip_count: 0,
    }));
  });
});

describe('findStopConnections', () => {
  it('同一便で origin から dest へ進むバス接続だけ返す', async () => {
    const rows = await findStopConnections('F1', ['S_NEAR'], ['S3'], '20260629', {
      departureAfter: '07:30:00',
      departureBefore: '09:00:00',
      limit: 5,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.departure_time).toBe('08:00:00');
    expect(rows[0]!.arrival_time).toBe('08:20:00');
    expect(rows[0]!.route_name).toBe('0001');
    expect(rows[0]!.origin_stop_name).toBe('駅前');
    expect(rows[0]!.dest_stop_name).toBe('三番');
  });

  it('逆順の停留所は接続候補にしない', async () => {
    const rows = await findStopConnections('F1', ['S3'], ['S_NEAR'], '20260629', {
      departureAfter: '00:00:00',
      limit: 5,
    });
    expect(rows).toEqual([]);
  });
});

describe('searchRouteGraph', () => {
  it('Google API を使わず、取り込み済み停留所グラフから経路候補を返す', async () => {
    const res = await searchRouteGraph({
      from: { lat: 35.681, lng: 139.767 },
      to: { lat: 35.50, lng: 139.50 },
      date: '2026-06-29',
      time: '07:30',
      basis: 'departure',
    });
    expect(res.options.length).toBeGreaterThan(0);
    expect(res.options[0]).toEqual(expect.objectContaining({
      departure_time: '08:00',
      arrival_time: '08:20',
      transfer_count: 0,
    }));
    expect(res.options[0]!.legs[0]).toEqual(expect.objectContaining({
      origin_stop_name: '駅前',
      dest_stop_name: '三番',
    }));
  });
});
