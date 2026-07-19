import { describe, expect, it } from 'vitest';
import { groupFacilitiesByPlace, wantedFacilityNames } from './placeFacilities.js';
import type { PlaceFacility } from '../types.js';

const facility = (id: string, placeId: string, name: string, wanted: number): PlaceFacility => ({
  id,
  place_id: placeId,
  name,
  source: 'manual',
  order_index: 0,
  wanted,
});

describe('placeFacilities', () => {
  it('場所ごとに設備をまとめ、チェック済みの名前だけ返す', () => {
    const grouped = groupFacilitiesByPlace([
      facility('a', 'place-1', '温泉', 1),
      facility('b', 'place-1', 'プール', 0),
      facility('c', 'place-2', '展望台', 1),
    ]);

    expect(grouped.get('place-1')?.map((item) => item.name)).toEqual(['温泉', 'プール']);
    expect(wantedFacilityNames(grouped, 'place-1')).toEqual(['温泉']);
    expect(wantedFacilityNames(grouped, 'unknown')).toEqual([]);
  });
});
