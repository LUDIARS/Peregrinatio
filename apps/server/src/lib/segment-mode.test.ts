import { describe, expect, it } from 'vitest';
import { haversineMeters, suggestSegmentMode, SHORT_WALK_THRESHOLD_M } from './segment-mode.js';

describe('haversineMeters', () => {
  it('同一点は 0m', () => {
    expect(haversineMeters({ lat: 35.0, lng: 139.0 }, { lat: 35.0, lng: 139.0 })).toBe(0);
  });
  it('東京駅〜新宿駅 はおよそ 6km (±1km)', () => {
    const d = haversineMeters({ lat: 35.681, lng: 139.767 }, { lat: 35.690, lng: 139.700 });
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(7000);
  });
});

describe('suggestSegmentMode', () => {
  it('500m 以内はどの primary でも徒歩', () => {
    for (const primary of ['driving', 'walking', 'transit', 'bicycling'] as const) {
      expect(suggestSegmentMode(300, primary)).toBe('walking');
      expect(suggestSegmentMode(SHORT_WALK_THRESHOLD_M, primary)).toBe('walking');
    }
  });
  it('500m 超 + 車 → 車', () => {
    expect(suggestSegmentMode(2000, 'driving')).toBe('driving');
  });
  it('500m 超 + 自転車 → 自転車', () => {
    expect(suggestSegmentMode(2000, 'bicycling')).toBe('bicycling');
  });
  it('500m 超 + 車以外(徒歩) → 公共交通', () => {
    expect(suggestSegmentMode(2000, 'walking')).toBe('transit');
  });
  it('500m 超 + 公共交通 → 公共交通', () => {
    expect(suggestSegmentMode(2000, 'transit')).toBe('transit');
  });
});
