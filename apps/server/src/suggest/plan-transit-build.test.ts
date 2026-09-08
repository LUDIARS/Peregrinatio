import { describe, expect, it } from 'vitest';
import { buildTransitPlanDays, poolFromNewCandidates, type PoolEntry } from './plan-transit-build.js';
import type { TransitConnection, TransitConnector } from './transit-connect.js';
import type { PlanAnchor } from './plan-build.js';
import { normalizePlanInput } from './plan-input.js';
import { gtfsTimeToMinutes, minutesToSearchTime, toGtfsDate } from './plan-time.js';
import type { PlanSuggestInput } from './types.js';

const BASE: PlanAnchor = {
  label: '宿', place_id: 'base', point: { lat: 37.0, lng: 140.0 }, note: null,
  checkin_time: '15:00', checkout_time: '10:00',
};

const input = (over: Partial<PlanSuggestInput> = {}) =>
  normalizePlanInput({ primary_mode: 'transit', ...over });

function entry(id: string, name: string, lat: number, lng: number, isAnchor = true): PoolEntry {
  return {
    place_id: id, name, point: { lat, lng }, category: null,
    is_anchor: isAnchor, is_new: false, reason: 'テスト候補',
  };
}

function connection(departMin: number, arriveMin: number): TransitConnection {
  return {
    depart_min: departMin,
    arrive_min: arriveMin,
    leg: {
      summary: 'テスト線',
      departure_time: minutesToSearchTime(departMin),
      arrival_time: minutesToSearchTime(arriveMin),
      transfer_count: 0,
      walk_from_m: 200,
      walk_to_m: 300,
    },
  };
}

/**
 * 便を持つ路線を模した見積り器。
 * @param travelMin 乗車時間
 * @param headwayMin 運行間隔 (この間隔でしか乗れない)
 * @param lastDepartMin 最終便の発車時刻。これを過ぎると便が無い。
 */
function fakeConnector(travelMin: number, headwayMin: number, lastDepartMin: number): TransitConnector {
  return {
    queryCount: () => 0,
    depart: async (_from, _to, earliest) => {
      const depart = Math.ceil(earliest / headwayMin) * headwayMin;
      if (depart > lastDepartMin) return null;
      return connection(depart, depart + travelMin);
    },
    arriveBy: async (_from, _to, latest) => {
      const latestDepart = Math.min(lastDepartMin, Math.floor((latest - travelMin) / headwayMin) * headwayMin);
      if (latestDepart < 0) return null;
      return connection(latestDepart, latestDepart + travelMin);
    },
  };
}

/** 便が 1 本も無い路線。 */
const emptyConnector: TransitConnector = {
  queryCount: () => 0,
  depart: async () => null,
  arriveBy: async () => null,
};

describe('plan-time — GTFS 時刻', () => {
  it('24 時を超える深夜便を丸めない', () => {
    expect(gtfsTimeToMinutes('25:10:00')).toBe(25 * 60 + 10);
  });
  it('秒あり・秒なしのどちらも読む', () => {
    expect(gtfsTimeToMinutes('09:05')).toBe(545);
    expect(gtfsTimeToMinutes('09:05:30')).toBe(545);
  });
  it('不正な時刻は null', () => {
    expect(gtfsTimeToMinutes('9時5分')).toBeNull();
    expect(gtfsTimeToMinutes('09:75')).toBeNull();
  });
  it('YYYY-MM-DD を GTFS の日付にする', () => {
    expect(toGtfsDate('2026-08-26')).toBe('20260826');
    expect(toGtfsDate('2026/08/26')).toBeNull();
    expect(toGtfsDate(null)).toBeNull();
  });
});

describe('buildTransitPlanDays', () => {
  const pool = [
    entry('p1', '目当ての美術館', 37.02, 140.02),
    entry('p2', '近くの公園', 37.01, 140.01),
  ];

  it('実便で組んだ移動には時刻表由来の印が付く', async () => {
    const out = await buildTransitPlanDays(
      { input: input(), dates: ['2026-08-26'], base: BASE, origin: null, pool: [...pool], mustIds: new Set() },
      () => fakeConnector(30, 30, 17 * 60),
    );
    const moves = out.days[0]?.items.filter((i) => i.kind === 'move') ?? [];
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(move.duration_source).toBe('gtfs');
      expect(move.transit).not.toBeNull();
      expect(move.mode).toBe('transit');
    }
  });

  it('主軸 (pool の先頭) から順に置く', async () => {
    const out = await buildTransitPlanDays(
      { input: input(), dates: ['2026-08-26'], base: BASE, origin: null, pool: [...pool], mustIds: new Set() },
      () => fakeConnector(20, 20, 17 * 60),
    );
    const visits = (out.days[0]?.items ?? []).filter((i) => i.kind === 'visit' && i.place_id !== 'base');
    expect(visits[0]?.label).toBe('目当ての美術館');
  });

  it('拠点へ戻る便が無い候補は置かず、理由付きで leftovers に落ちる', async () => {
    // 行きの便には乗れるが、最終便が早すぎて滞在後には戻れない路線。
    // (拠点のチェックアウト 10:00 が活動開始なので、行きは 11:00 発に乗れる)
    const out = await buildTransitPlanDays(
      { input: input({ day_start: '09:00', day_end: '18:00' }), dates: ['2026-08-26'], base: BASE, origin: null, pool: [...pool], mustIds: new Set() },
      () => fakeConnector(60, 60, 11 * 60),
    );
    expect(out.leftovers.length).toBeGreaterThan(0);
    expect(out.leftovers[0]?.reason).toMatch(/戻れ|最終便/);
  });

  it('便が 1 本も無ければ unusable を返す (黙って概算に落ちない)', async () => {
    const out = await buildTransitPlanDays(
      { input: input(), dates: ['2026-08-26'], base: BASE, origin: null, pool: [...pool], mustIds: new Set() },
      () => emptyConnector,
    );
    expect(out.unusable).toBe(true);
    expect(out.leftovers.map((l) => l.reason)).toContain('公共交通で行ける便が見つかりませんでした。');
  });

  it('日付が無い日は便を引けないので予定を置かない', async () => {
    const out = await buildTransitPlanDays(
      { input: input(), dates: [null], base: BASE, origin: null, pool: [...pool], mustIds: new Set() },
      () => fakeConnector(20, 20, 17 * 60),
    );
    const visits = (out.days[0]?.items ?? []).filter((i) => i.kind === 'visit' && i.place_id !== 'base');
    expect(visits).toHaveLength(0);
  });

  it('出発地点があれば長距離の往路・復路を別手配のメモとして置く', async () => {
    const origin: PlanAnchor = { label: '自宅', place_id: null, point: { lat: 35.9, lng: 139.6 }, note: null };
    const out = await buildTransitPlanDays(
      { input: input(), dates: ['2026-08-26', '2026-08-27'], base: BASE, origin, pool: [...pool], mustIds: new Set() },
      () => fakeConnector(20, 20, 17 * 60),
    );
    expect(out.days[0]?.items[0]?.note).toContain('別手配');
    const last = out.days[1]?.items[(out.days[1]?.items.length ?? 1) - 1];
    expect(last?.note).toContain('別手配');
  });
});

describe('poolFromNewCandidates', () => {
  it('旅にまだ無い候補は place_id を持たず、その旨が理由に出る', () => {
    const pool = poolFromNewCandidates([{
      name: '〇〇美術館', address: null, lat: 37.0, lng: 140.0,
      google_place_id: 'abc', category: null, found_by: '名所',
    }]);
    expect(pool[0]?.place_id).toBeNull();
    expect(pool[0]?.is_new).toBe(true);
    expect(pool[0]?.reason).toContain('まだ旅に入っていません');
  });
});
