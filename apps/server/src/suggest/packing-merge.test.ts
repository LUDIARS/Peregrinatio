import { describe, expect, it } from 'vitest';
import { buildPackingSuggestions, normalizeTitle, resolveClothingCap } from './packing-merge.js';
import { matchFacilityRules } from './packing-facility-rules.js';
import { matchSeasonRules } from './packing-season-rules.js';

describe('normalizeTitle', () => {
  it('括弧書き・空白・大小の差を吸収する', () => {
    expect(normalizeTitle('洗濯洗剤 (小分け)')).toBe(normalizeTitle('洗濯洗剤'));
    expect(normalizeTitle('ＵＳＢ ケーブル')).toBe(normalizeTitle('usbケーブル'));
  });
});

describe('resolveClothingCap', () => {
  it('乾燥機があれば着替えに上限が付く', () => {
    expect(resolveClothingCap(matchFacilityRules(['コインランドリー']))).toBe(2);
  });
  it('該当が無ければ上限なし', () => {
    expect(resolveClothingCap(matchFacilityRules(['朝食ビュッフェ']))).toBeNull();
  });
});

describe('buildPackingSuggestions', () => {
  it('乾燥機があると着替えが泊数分より少なくなる', () => {
    const withDryer = buildPackingSuggestions({
      nights: 4,
      facilityHits: matchFacilityRules(['乾燥機']),
      seasonRules: [],
      existing: [],
    });
    const withoutDryer = buildPackingSuggestions({
      nights: 4, facilityHits: [], seasonRules: [], existing: [],
    });
    const tops = (r: typeof withDryer) => r.suggestions.find((s) => s.title.startsWith('着替え'))?.quantity;
    expect(tops(withoutDryer)).toBe(5);
    expect(tops(withDryer)).toBe(2);
  });

  it('プール・海があれば水着が出る', () => {
    const built = buildPackingSuggestions({
      nights: 1,
      facilityHits: matchFacilityRules(['屋外プール']),
      seasonRules: [],
      existing: [],
    });
    expect(built.suggestions.map((s) => s.title)).toContain('水着');
  });

  it('行き先が海水浴場でも水着が出る (設備でなく行き先由来)', () => {
    const built = buildPackingSuggestions({
      nights: 1,
      facilityHits: matchFacilityRules(['白浜海水浴場']),
      seasonRules: [],
      existing: [],
    });
    expect(built.suggestions.map((s) => s.title)).toContain('水着');
  });

  it('紅葉の時期は羽織ものが出る', () => {
    const built = buildPackingSuggestions({
      nights: 1, facilityHits: [], seasonRules: matchSeasonRules(['autumn_leaves']), existing: [],
    });
    expect(built.suggestions.map((s) => s.title)).toContain('羽織もの (薄手)');
  });

  it('猛暑は日避けが出る', () => {
    const built = buildPackingSuggestions({
      nights: 1, facilityHits: [], seasonRules: matchSeasonRules(['heat']), existing: [],
    });
    const titles = built.suggestions.map((s) => s.title);
    expect(titles).toContain('日傘');
    expect(titles).toContain('帽子');
  });

  it('同じ荷物が複数の由来から出たら 1 件に束ねる', () => {
    const built = buildPackingSuggestions({
      nights: 1,
      facilityHits: matchFacilityRules(['スキー場']),
      seasonRules: matchSeasonRules(['heat']),
      existing: [],
    });
    const sunscreen = built.suggestions.filter((s) => s.title === '日焼け止め');
    expect(sunscreen).toHaveLength(1);
    expect(sunscreen[0]?.origins.length).toBeGreaterThan(1);
  });

  it('大浴場があるとバスタオルは持参不要として外れる', () => {
    const built = buildPackingSuggestions({
      nights: 1,
      facilityHits: matchFacilityRules(['大浴場']),
      seasonRules: [],
      existing: [{ id: 'i1', title: 'バスタオル' }],
    });
    expect(built.drops.map((d) => d.title)).toContain('バスタオル');
    expect(built.drops.find((d) => d.title === 'バスタオル')?.existing_item_id).toBe('i1');
    expect(built.suggestions.map((s) => s.title)).not.toContain('バスタオル');
  });

  it('個別アメニティは実際に記載された品だけを持参不要にする', () => {
    const built = buildPackingSuggestions({
      nights: 1,
      facilityHits: matchFacilityRules(['歯ブラシ']),
      seasonRules: [],
      existing: [],
    });
    expect(built.drops.map((d) => d.title)).toContain('歯ブラシ');
    expect(built.drops.map((d) => d.title)).not.toContain('シャンプー');
    expect(built.drops.map((d) => d.title)).not.toContain('ドライヤー');
  });

  it('既にリストにあるものは already_listed が立つ', () => {
    const built = buildPackingSuggestions({
      nights: 1, facilityHits: [], seasonRules: [], existing: [{ id: 'i2', title: 'スマホ充電器' }],
    });
    expect(built.suggestions.find((s) => s.title === 'スマホ充電器')?.already_listed).toBe(true);
  });
});
