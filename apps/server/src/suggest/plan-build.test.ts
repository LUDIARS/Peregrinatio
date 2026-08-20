import { describe, expect, it } from 'vitest';
import { anchorsForDay, buildPlanDays, dayWindow, type PlanAnchor } from './plan-build.js';
import { estimateTravel, type GeoPoint, type TravelEstimator } from './plan-travel.js';
import { normalizePlanInput } from './plan-input.js';
import { parseHhmm } from './plan-time.js';
import type { TripPlace } from '../types.js';
import type { PlanPace, PlanSuggestInput } from './types.js';

/** Routes API を叩かない見積り器 (概算をそのまま返す)。 */
function fakeEstimator(mode: PlanSuggestInput['primary_mode']): TravelEstimator {
  return {
    warnings: () => [],
    estimate: async (from: GeoPoint, to: GeoPoint) => estimateTravel(from, to, mode),
  };
}

function place(id: string, name: string, lat: number, lng: number, category: string | null = null): TripPlace {
  return {
    id, name, address: null, lat, lng, category,
    source_url: null, summary: null, notes: null, image_url: null,
    status: 'none', status_by: null, google_place_id: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
    is_base: 0, base_name: null, base_name_source: null,
    checkin_time: null, checkout_time: null, postponed: 0,
  };
}

const BASE: PlanAnchor = {
  label: '宿', place_id: 'base', point: { lat: 35.0, lng: 135.0 }, note: null,
  checkin_time: '15:00', checkout_time: '10:00',
};

const input = (over: Partial<PlanSuggestInput> = {}) => normalizePlanInput({ ...over });

describe('anchorsForDay', () => {
  const origin: PlanAnchor = { label: '自宅', place_id: null, point: { lat: 34.9, lng: 134.9 }, note: null };
  const fallback: PlanAnchor = { label: 'fallback', place_id: null, point: { lat: 0, lng: 0 }, note: null };

  it('初日は出発地点から出て拠点で終わる', () => {
    const { start, end } = anchorsForDay(0, 3, origin, BASE, fallback);
    expect(start.label).toBe('自宅');
    expect(end.label).toBe('宿');
  });
  it('中日は拠点から拠点', () => {
    const { start, end } = anchorsForDay(1, 3, origin, BASE, fallback);
    expect(start.label).toBe('宿');
    expect(end.label).toBe('宿');
  });
  it('最終日は拠点から出発地点へ戻る', () => {
    const { start, end } = anchorsForDay(2, 3, origin, BASE, fallback);
    expect(start.label).toBe('宿');
    expect(end.label).toBe('自宅');
  });
  it('拠点も出発地点も無ければ fallback を使う', () => {
    const { start, end } = anchorsForDay(0, 1, null, null, fallback);
    expect(start.label).toBe('fallback');
    expect(end.label).toBe('fallback');
  });
});

describe('dayWindow', () => {
  it('最終日はチェックアウト後にしか動き出せない', () => {
    const w = dayWindow(1, 2, input({ day_start: '08:00', day_end: '18:00' }), BASE);
    expect(w.start).toBe(parseHhmm('10:00'));
  });
  it('最終日以外はチェックアウトに縛られない', () => {
    const w = dayWindow(0, 2, input({ day_start: '08:00', day_end: '18:00' }), BASE);
    expect(w.start).toBe(parseHhmm('08:00'));
  });
});

describe('buildPlanDays', () => {
  const near = [
    place('p1', '近くの寺', 35.005, 135.005, '神社'),
    place('p2', '市場', 35.008, 135.002, '市場'),
    place('p3', '美術館', 35.002, 135.009, '美術館'),
  ];

  it('日数分の日を必ず返し、各日は端点で始まり端点で終わる', async () => {
    const out = await buildPlanDays(
      {
        input: input({ primary_mode: 'walking' }),
        dates: ['2026-10-20', '2026-10-21'],
        origin: null,
        base: BASE,
        candidates: near,
        mustIds: new Set(),
      },
      fakeEstimator('walking'),
    );
    expect(out.days).toHaveLength(2);
    for (const day of out.days) {
      expect(day.items[0]?.label).toBe('宿');
      expect(day.items[day.items.length - 1]?.label).toBe('宿');
    }
  });

  it('活動時間帯に収まらない場所は leftovers に落ちる', async () => {
    const far = [...near, place('p9', '遠方の島', 40.0, 141.0)];
    const out = await buildPlanDays(
      {
        input: input({ primary_mode: 'walking', day_start: '09:00', day_end: '17:00' }),
        dates: ['2026-10-20'],
        origin: null,
        base: BASE,
        candidates: far,
        mustIds: new Set(),
      },
      fakeEstimator('walking'),
    );
    expect(out.leftovers.map((l) => l.place_id)).toContain('p9');
  });

  it('位置情報が無い場所は理由付きで leftovers に落ちる', async () => {
    const noGeo: TripPlace = { ...place('p0', '住所未確定の宿', 0, 0), lat: null, lng: null };
    const out = await buildPlanDays(
      {
        input: input(),
        dates: ['2026-10-20'],
        origin: null,
        base: BASE,
        candidates: [noGeo],
        mustIds: new Set(),
      },
      fakeEstimator('transit'),
    );
    expect(out.leftovers[0]?.place_id).toBe('p0');
    expect(out.leftovers[0]?.reason).toContain('位置情報');
  });

  it('詰め込みペースはゆったりより多く回る', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      place(`m${i}`, `場所${i}`, 35.0 + i * 0.002, 135.0 + i * 0.002, 'カフェ'));
    const run = async (pace: PlanPace) => {
      const out = await buildPlanDays(
        {
          input: input({ pace, primary_mode: 'walking' }),
          dates: ['2026-10-20'],
          origin: null,
          base: BASE,
          candidates: many,
          mustIds: new Set(),
        },
        fakeEstimator('walking'),
      );
      return out.days[0]?.items.filter((i) => i.kind === 'visit' && i.place_id !== 'base').length ?? 0;
    };
    expect(await run('packed')).toBeGreaterThan(await run('relaxed'));
  });

  it('must 指定は距離が遠くても通常候補より先に入れる', async () => {
    const must = place('must', '必ず行く場所', 35.05, 135.05, '名所');
    const out = await buildPlanDays(
      {
        input: input({ pace: 'relaxed', primary_mode: 'walking', day_start: '08:00', day_end: '20:00' }),
        dates: ['2026-10-20'],
        origin: null,
        base: BASE,
        candidates: [...near, must],
        mustIds: new Set([must.id]),
      },
      fakeEstimator('walking'),
    );
    expect(out.days[0]?.items.some((item) => item.place_id === must.id)).toBe(true);
    expect(out.leftovers.map((item) => item.place_id)).not.toContain(must.id);
  });

  it('移動には手段と所要の出所が入る', async () => {
    const out = await buildPlanDays(
      {
        input: input({ primary_mode: 'walking' }),
        dates: ['2026-10-20'],
        origin: null,
        base: BASE,
        candidates: near,
        mustIds: new Set(),
      },
      fakeEstimator('walking'),
    );
    const moves = out.days[0]?.items.filter((i) => i.kind === 'move') ?? [];
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(move.mode).not.toBeNull();
      expect(move.duration_source).toBe('estimate');
    }
  });
});
