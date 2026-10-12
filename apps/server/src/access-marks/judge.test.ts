import { describe, expect, it, vi } from 'vitest';
import { judgeAccessMarks, type AccessLookups, type NamedPoint } from './judge.js';
import { excerptAround, judgeShuttleBus } from './shuttle.js';
import { judgeTaxiFirstFare } from './taxi.js';
import { DRIVING_DETOUR } from '../suggest/plan-travel.js';
import type { AccessCandidate } from './types.js';

// 緯度 0.001 度 ≈ 111m。
const at = (dLatM: number, name = 'p'): NamedPoint => ({ name, lat: 37 + dLatM / 111_195, lng: 140 });
const candidate = (texts: AccessCandidate['texts'] = null): AccessCandidate => ({ cache_key: 'k', lat: 37, lng: 140, texts });

function lookups(overrides: Partial<AccessLookups> = {}): AccessLookups {
  return {
    placesEnabled: true,
    expressStations: async () => [],
    gtfsRailStops: async () => [],
    placesStation: vi.fn(async () => null),
    gtfsBusStops: async () => [],
    placesBusStop: vi.fn(async () => null),
    shuttleExtraction: async () => null,
    ...overrides,
  };
}

describe('judgeTaxiFirstFare', () => {
  it('道のり = 直線 × 車の迂回係数で、閾値以内なら近い起点を根拠にする', () => {
    const base = { kind: 'base' as const, name: '宿', point: at(800) };
    const station = { kind: 'station' as const, name: '那須塩原駅', point: at(500) };
    const mark = judgeTaxiFirstFare(at(0), [base, station], 1_200);
    expect(mark?.origin_kind).toBe('station');
    expect(mark?.distance_m).toBe(Math.round(500 * DRIVING_DETOUR));
    expect(mark?.threshold_m).toBe(1_200);
  });

  it('どの起点からも閾値を超えれば印を付けない', () => {
    const base = { kind: 'base' as const, name: '宿', point: at(1_000) };
    expect(judgeTaxiFirstFare(at(0), [base], 1_200)).toBeNull(); // 1000 × 1.35 > 1200
    expect(judgeTaxiFirstFare(at(0), [base], 1_500)).not.toBeNull();
  });
});

describe('judgeAccessMarks', () => {
  it('印が付かないときはキーごと省く (否定の印を出さない)', async () => {
    const marks = await judgeAccessMarks(candidate(), null, 1_200, lookups());
    expect(marks).toEqual({});
  });

  it('最寄り駅は新幹線・特急の駅を優先し、GTFS・Places を呼ばない', async () => {
    const gtfsRail = vi.fn(async () => [at(100, 'GTFS駅')]);
    const l = lookups({ expressStations: async () => [at(600, '那須塩原')], gtfsRailStops: gtfsRail });
    const marks = await judgeAccessMarks(candidate(), null, 1_200, l);
    expect(marks.taxi_first_fare?.origin_name).toBe('那須塩原駅');
    expect(gtfsRail).not.toHaveBeenCalled();
    expect(l.placesStation).not.toHaveBeenCalled();
  });

  it('3km を超える駅は最寄り駅にしない', async () => {
    const l = lookups({ expressStations: async () => [at(3_500, '遠い駅')] });
    const marks = await judgeAccessMarks(candidate(), null, 10_000, l);
    expect(marks.taxi_first_fare).toBeUndefined();
  });

  it('バス停は GTFS で見つかれば Places を呼ばない', async () => {
    const l = lookups({ gtfsBusStops: async () => [at(120, '温泉入口')] });
    const marks = await judgeAccessMarks(candidate(), null, 1_200, l);
    expect(marks.bus_stop_near).toMatchObject({ stop_name: '温泉入口', source: 'gtfs', radius_m: 300 });
    expect(l.placesBusStop).not.toHaveBeenCalled();
  });

  it('GTFS に無ければ Places で探し、キー未設定なら Places を呼ばない', async () => {
    const withKey = lookups({ placesBusStop: vi.fn(async () => at(200, '役場前')) });
    expect((await judgeAccessMarks(candidate(), null, 1_200, withKey)).bus_stop_near?.source).toBe('places');
    const noKey = lookups({ placesEnabled: false, placesBusStop: vi.fn(async () => at(200, '役場前')) });
    expect((await judgeAccessMarks(candidate(), null, 1_200, noKey)).bus_stop_near).toBeUndefined();
    expect(noKey.placesBusStop).not.toHaveBeenCalled();
  });

  it('Places が落ちたら印を付けず、調べきれなかったことを unchecked で示す', async () => {
    const l = lookups({
      placesStation: vi.fn(async () => { throw new Error('quota'); }),
      placesBusStop: vi.fn(async () => { throw new Error('quota'); }),
    });
    const marks = await judgeAccessMarks(candidate(), null, 1_200, l);
    expect(marks.taxi_first_fare).toBeUndefined();
    expect(marks.bus_stop_near).toBeUndefined();
    expect(Object.keys(marks.unchecked ?? {})).toEqual(['taxi_first_fare', 'bus_stop_near']);
  });

  it('未保存の候補 (本文なし) にはシャトルの印を付けない', async () => {
    const l = lookups({ shuttleExtraction: async () => ({ available: true, evidence: 'x', source_url: null }) });
    expect((await judgeAccessMarks(candidate(null), null, 1_200, l)).shuttle_bus).toBeUndefined();
  });
});

describe('judgeShuttleBus', () => {
  const texts = (summary: string | null, notes: string | null = null, facilities: string[] = []) =>
    ({ place_id: 'p', summary, notes, facilities });

  it('要約・メモ・設備から送迎系の語を探して根拠を抜き出す', () => {
    expect(judgeShuttleBus(texts('那須塩原駅から無料送迎バスを運行しています。'), null)?.source).toBe('summary');
    expect(judgeShuttleBus(texts(null, null, ['シャトルバス']), null)?.source).toBe('facility');
    expect(judgeShuttleBus(texts('温泉と露天風呂'), null)).toBeNull();
  });

  it('「送迎なし」のような否定は根拠にしない', () => {
    expect(judgeShuttleBus(texts('送迎はございません。'), null)).toBeNull();
    expect(judgeShuttleBus(texts('送迎なし。'), null)).toBeNull();
  });

  it('クロール→LLM の抽出結果を優先する (無いと言えばキーワードがあっても付けない)', () => {
    const t = texts('送迎バスあり');
    expect(judgeShuttleBus(t, { available: false, evidence: null, source_url: null })).toBeNull();
    const yes = judgeShuttleBus(texts(null), { available: true, evidence: '駅から送迎', source_url: 'https://x' });
    expect(yes).toEqual({ evidence: '駅から送迎', source: 'crawl', source_url: 'https://x' });
  });

  it('抜粋は前後 40 文字', () => {
    const text = `${'あ'.repeat(60)}送迎バス${'い'.repeat(60)}`;
    const ex = excerptAround(text, 60, 4);
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
    expect(Array.from(ex).length).toBe(40 + 4 + 40 + 2);
  });
});
