import { describe, expect, it } from 'vitest';
import {
  MAX_REACH_RADIUS_M, MIN_REACH_RADIUS_M, isRailStationResult, resolvePlanReach,
} from './plan-reach.js';
import { DEFAULT_STATION_HOPS, MAX_STATION_HOPS, normalizePlanInput } from './plan-input.js';

const BASE_POINT = { lat: 37.0, lng: 140.0 };

describe('isRailStationResult', () => {
  it('種別が鉄道駅なら採る', () => {
    expect(isRailStationResult({ name: '黒磯', category: 'train_station' })).toBe(true);
    expect(isRailStationResult({ name: '大手町', category: 'subway_station' })).toBe(true);
  });
  it('名前が「駅」で終われば採る', () => {
    expect(isRailStationResult({ name: '那須塩原駅', category: null })).toBe(true);
  });
  it('道の駅・バス停は駅として数えない', () => {
    expect(isRailStationResult({ name: '道の駅 那須高原友愛の森', category: null })).toBe(false);
    expect(isRailStationResult({ name: '那須湯本バス停', category: null })).toBe(false);
    expect(isRailStationResult({ name: '那須高原バスターミナル', category: null })).toBe(false);
  });
  it('駅でない施設は落とす', () => {
    expect(isRailStationResult({ name: 'リゾナーレ那須', category: 'lodging' })).toBe(false);
  });
});

describe('resolvePlanReach — 半径の直接指定', () => {
  const manual = (radius: number) =>
    resolvePlanReach({ base: BASE_POINT, hops: DEFAULT_STATION_HOPS, apiKey: '', manualRadiusM: radius });

  it('範囲内の指定はそのまま使い、警告を出さない', async () => {
    const reach = await manual(8_000);
    expect(reach?.radius_m).toBe(8_000);
    expect(reach?.source).toBe('manual');
    expect(reach?.warnings).toEqual([]);
  });

  it('下限を下回る指定は丸めた旨を警告に出す', async () => {
    const reach = await manual(1_000);
    expect(reach?.radius_m).toBe(MIN_REACH_RADIUS_M);
    expect(reach?.warnings[0]).toContain('丸めました');
  });

  it('上限を超える指定は丸めた旨を警告に出す', async () => {
    const reach = await manual(90_000);
    expect(reach?.radius_m).toBe(MAX_REACH_RADIUS_M);
    expect(reach?.warnings[0]).toContain('丸めました');
  });

  it('拠点が無ければ範囲を絞れないので null', async () => {
    const reach = await resolvePlanReach({
      base: null, hops: DEFAULT_STATION_HOPS, apiKey: '', manualRadiusM: null,
    });
    expect(reach).toBeNull();
  });
});

describe('normalizePlanInput — 到達範囲', () => {
  it('未指定なら既定の駅数、半径は自動算出', () => {
    const v = normalizePlanInput({});
    expect(v.max_station_hops).toBe(DEFAULT_STATION_HOPS);
    expect(v.reach_radius_m).toBeNull();
  });
  it('駅数の範囲外・非整数は既定に戻る', () => {
    expect(normalizePlanInput({ max_station_hops: 0 }).max_station_hops).toBe(DEFAULT_STATION_HOPS);
    expect(normalizePlanInput({ max_station_hops: MAX_STATION_HOPS + 1 }).max_station_hops).toBe(DEFAULT_STATION_HOPS);
    expect(normalizePlanInput({ max_station_hops: 2.5 }).max_station_hops).toBe(DEFAULT_STATION_HOPS);
  });
  it('妥当な駅数は通る', () => {
    expect(normalizePlanInput({ max_station_hops: 2 }).max_station_hops).toBe(2);
  });
  it('半径の直接指定は範囲内だけ通り、範囲外は自動算出に戻す', () => {
    expect(normalizePlanInput({ reach_radius_m: 8000 }).reach_radius_m).toBe(8000);
    expect(normalizePlanInput({ reach_radius_m: 10 }).reach_radius_m).toBeNull();
    expect(normalizePlanInput({ reach_radius_m: 999_999 }).reach_radius_m).toBeNull();
    expect(normalizePlanInput({ reach_radius_m: 'far' }).reach_radius_m).toBeNull();
  });
});
