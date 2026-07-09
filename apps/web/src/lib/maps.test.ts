import { describe, expect, it } from 'vitest';
import { placeTypeColor, placeTypeLabel, transitRouteStyle, UNCATEGORIZED_PLACE_TYPE } from './maps.js';

describe('place type helpers', () => {
  it('カテゴリが空なら未分類として扱う', () => {
    expect(placeTypeLabel(null)).toBe(UNCATEGORIZED_PLACE_TYPE);
    expect(placeTypeLabel('')).toBe(UNCATEGORIZED_PLACE_TYPE);
    expect(placeTypeLabel('  温泉  ')).toBe('温泉');
  });

  it('同じタイプは安定した色になる', () => {
    expect(placeTypeColor('温泉')).toBe(placeTypeColor('温泉'));
    expect(placeTypeColor('美術館')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('transit route style', () => {
  it('新幹線、シャトルバス、通常バス、電車を判定する', () => {
    expect(transitRouteStyle({ routeLabel: '東北新幹線 なすの' }).kind).toBe('shinkansen');
    expect(transitRouteStyle({ routeType: 3, routeLabel: 'ホテルシャトルバス' }).kind).toBe('shuttle_bus');
    expect(transitRouteStyle({ routeType: 3, routeLabel: '市内循環' }).kind).toBe('bus');
    expect(transitRouteStyle({ routeType: 2, routeLabel: '山手線' }).kind).toBe('rail');
  });
});
