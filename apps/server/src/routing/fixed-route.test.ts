import { describe, expect, it } from 'vitest';
import { FixedRouteInputError, parseFixedRouteInput } from './fixed-route.js';

describe('parseFixedRouteInput', () => {
  it('accepts a confirmed transit route and normalizes optional text', () => {
    expect(parseFixedRouteInput({
      mode: 'transit',
      transit_kind: 'shinkansen',
      depart_time: '09:05',
      arrive_time: '',
      note: '  予約済み  ',
      is_fixed: true,
    })).toEqual({
      mode: 'transit',
      transitKind: 'shinkansen',
      departTime: '09:05',
      arriveTime: null,
      note: '予約済み',
      isFixed: 1,
    });
  });

  it.each([null, undefined, 'route', []])('rejects a non-object body: %j', (input) => {
    expect(() => parseFixedRouteInput(input)).toThrow(FixedRouteInputError);
  });

  it('rejects invalid time and transit combinations', () => {
    expect(() => parseFixedRouteInput({
      mode: 'walking', transit_kind: 'train', is_fixed: true,
    })).toThrow('transit_kind は mode=transit');
    expect(() => parseFixedRouteInput({
      mode: 'transit', transit_kind: 'train', depart_time: '24:00', is_fixed: true,
    })).toThrow('HH:MM');
  });
});
