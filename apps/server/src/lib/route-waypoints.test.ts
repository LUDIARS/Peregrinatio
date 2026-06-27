import { describe, expect, it } from 'vitest';
import { buildRouteWaypoints } from './route-waypoints.js';

const P = (id: string, lat: number, lng: number) => ({ place_id: id, lat, lng });
const ORIGIN = { label: '自宅', lat: 35.0, lng: 139.0 };

describe('buildRouteWaypoints', () => {
  it('出発地点なしは place 列そのまま (label は全て null)', () => {
    const w = buildRouteWaypoints([P('a', 1, 1), P('b', 2, 2)], null, { isFirstDay: true, isLastDay: true });
    expect(w.map((x) => x.place_id)).toEqual(['a', 'b']);
    expect(w.every((x) => x.label === null)).toBe(true);
  });

  it('初日は先頭に往路の出発地点を足す', () => {
    const w = buildRouteWaypoints([P('a', 1, 1), P('b', 2, 2)], ORIGIN, { isFirstDay: true, isLastDay: false });
    expect(w.map((x) => x.place_id)).toEqual([null, 'a', 'b']);
    expect(w[0]).toMatchObject({ label: '自宅', lat: 35.0, lng: 139.0 });
  });

  it('最終日は末尾に復路の帰着地点を足す', () => {
    const w = buildRouteWaypoints([P('a', 1, 1), P('b', 2, 2)], ORIGIN, { isFirstDay: false, isLastDay: true });
    expect(w.map((x) => x.place_id)).toEqual(['a', 'b', null]);
    expect(w.at(-1)?.label).toBe('自宅');
  });

  it('単日 (初日かつ最終日) は origin→place→origin の往復', () => {
    const w = buildRouteWaypoints([P('a', 1, 1)], ORIGIN, { isFirstDay: true, isLastDay: true });
    expect(w.map((x) => x.place_id)).toEqual([null, 'a', null]);
  });

  it('place 0 件なら出発地点だけの区間は作らない', () => {
    expect(buildRouteWaypoints([], ORIGIN, { isFirstDay: true, isLastDay: true })).toEqual([]);
  });

  it('中間日 (初日でも最終日でもない) は出発地点を足さない', () => {
    const w = buildRouteWaypoints([P('a', 1, 1)], ORIGIN, { isFirstDay: false, isLastDay: false });
    expect(w.map((x) => x.place_id)).toEqual(['a']);
  });
});
