import { describe, expect, it } from 'vitest';
import {
  normalizedPlaceCategory, placeTypeColor, placeTypeLabel, transitRouteStyle,
  PLACE_CATEGORY_OPTIONS, UNCATEGORIZED_PLACE_TYPE,
} from './maps.js';

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

  it('英語カテゴリを日本語表示にする', () => {
    expect(placeTypeLabel('resort_hotel')).toBe('リゾートホテル');
    expect(placeTypeLabel('train_station')).toBe('駅');
    expect(placeTypeLabel('RESORT_HOTEL')).toBe('リゾートホテル');
  });

  it('未知のカテゴリはそのまま返し、Object の継承プロパティ名も拾わない', () => {
    expect(placeTypeLabel('温泉')).toBe('温泉');
    expect(placeTypeLabel('constructor')).toBe('constructor');
    expect(placeTypeLabel('toString')).toBe('toString');
  });

  it('編集用カテゴリは未分類を空文字にする', () => {
    expect(normalizedPlaceCategory(null)).toBe('');
    expect(normalizedPlaceCategory('  ')).toBe('');
    expect(normalizedPlaceCategory('cafe')).toBe('カフェ');
    // 正規化後の値は、そのまま選択肢として提示できる必要がある。
    expect(PLACE_CATEGORY_OPTIONS).toContain(normalizedPlaceCategory('cafe'));
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
