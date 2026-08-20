import { describe, expect, it } from 'vitest';
import { baseVisitMinutes, DEFAULT_VISIT_MINUTES, visitMinutes } from './plan-visit.js';
import { estimateTravel } from './plan-travel.js';

describe('baseVisitMinutes', () => {
  it('種別ごとに滞在時間が変わる', () => {
    expect(baseVisitMinutes({ name: '〇〇水族館', category: null })).toBeGreaterThan(
      baseVisitMinutes({ name: '〇〇カフェ', category: null }),
    );
  });
  it('カテゴリでも照合する', () => {
    expect(baseVisitMinutes({ name: '名もなき場所', category: '美術館' })).toBe(90);
  });
  it('該当しなければ既定', () => {
    expect(baseVisitMinutes({ name: 'なにか', category: null })).toBe(DEFAULT_VISIT_MINUTES);
  });
});

describe('visitMinutes', () => {
  it('ペースで滞在時間が伸縮する', () => {
    const p = { name: '〇〇神社', category: null };
    expect(visitMinutes(p, 'relaxed')).toBeGreaterThan(visitMinutes(p, 'packed'));
  });
  it('最低 20 分は確保する', () => {
    expect(visitMinutes({ name: '〇〇駅', category: null }, 'packed')).toBeGreaterThanOrEqual(20);
  });
});

describe('estimateTravel', () => {
  const a = { lat: 35.0, lng: 135.0 };
  const b = { lat: 35.05, lng: 135.05 };

  it('同一地点は所要 0 (オーバーヘッドも付けない)', () => {
    expect(estimateTravel(a, a, 'transit').duration_sec).toBe(0);
  });
  it('徒歩は車より時間がかかる', () => {
    expect(estimateTravel(a, b, 'walking').duration_sec)
      .toBeGreaterThan(estimateTravel(a, b, 'driving').duration_sec);
  });
  it('概算であることを必ず示す', () => {
    expect(estimateTravel(a, b, 'transit').source).toBe('estimate');
  });
});
