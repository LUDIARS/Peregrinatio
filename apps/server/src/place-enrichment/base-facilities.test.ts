import { describe, expect, it } from 'vitest';
import { defaultBaseName, isFacilityListingPlace, unicodeLength } from './base-facilities.js';

describe('base/facility enrichment helpers', () => {
  it('Unicode文字単位で拠点名を8文字に収める', () => {
    const name = defaultBaseName('🏨とても長いホテル名称');
    expect(unicodeLength(name)).toBe(8);
    expect(name).toBe('🏨とても長いホテ');
  });

  it('拠点と複合施設だけを設備列挙の対象にする', () => {
    expect(isFacilityListingPlace({ name: '普通の宿', category: null, is_base: 1 })).toBe(true);
    expect(isFacilityListingPlace({ name: '駅前モール', category: null, is_base: 0 })).toBe(true);
    expect(isFacilityListingPlace({ name: '小さな公園', category: '公園', is_base: 0 })).toBe(false);
  });
});
