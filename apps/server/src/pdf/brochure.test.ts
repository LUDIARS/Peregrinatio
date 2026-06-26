// 旅のしおり (ツアーパンフレット風) HTML ビルダーの単体テスト。
// 純関数なので DB/Puppeteer 不要。主要セクションの存在・leg 突合・HTML エスケープを固定する。

import { describe, expect, it } from 'vitest';
import { buildBrochureHtml, type BrochureInput } from './brochure.js';
import type { ItineraryItem, Place, RouteLeg, Trip, TripDay } from '../types.js';

const trip: Trip = {
  id: 't1', title: '金沢の旅 <test>', start_date: '2026-07-18', end_date: '2026-07-20',
  cover_image_path: null, notes: null, archived: 0, created_at: '', updated_at: '',
};
const place = (id: string, name: string): Place => ({
  id, name, address: '住所', lat: 36, lng: 136, category: 'カテゴリ', source_url: null,
  summary: '概要', notes: null, image_url: null, status: 'interested', created_at: '', updated_at: '',
});

function baseInput(over: Partial<BrochureInput> = {}): BrochureInput {
  const days: TripDay[] = [{ id: 'd1', trip_id: 't1', day_index: 0, date: '7/18', title: '1日目', notes: null }];
  const p1 = place('p1', '兼六園');
  const p2 = place('p2', '21世紀美術館');
  const items: ItineraryItem[] = [
    { id: 'i1', day_id: 'd1', place_id: 'p1', order_index: 0, planned_time: '09:30', kind: 'visit', note: null },
    { id: 'i2', day_id: 'd1', place_id: 'p2', order_index: 1, planned_time: '11:30', kind: 'visit', note: null },
  ];
  const legs: RouteLeg[] = [
    { id: 'l1', day_id: 'd1', from_place_id: 'p1', to_place_id: 'p2', mode: 'walking', duration_sec: 720, distance_m: 850, fare_text: null, polyline: null, raw_json: null, computed_at: '' },
  ];
  return {
    trip,
    days,
    itemsByDay: new Map([['d1', items]]),
    legsByDay: new Map([['d1', legs]]),
    placeMap: new Map([['p1', p1], ['p2', p2]]),
    compositeByPlace: new Map(),
    assetBase: 'http://127.0.0.1:8090',
    ...over,
  };
}

describe('buildBrochureHtml', () => {
  it('表紙・行程概要・スポット名を含む', () => {
    const html = buildBrochureHtml(baseInput());
    expect(html).toContain('旅のしおり');
    expect(html).toContain('行程概要');
    expect(html).toContain('兼六園');
    expect(html).toContain('21世紀美術館');
    expect(html).toContain('2泊3日'); // start/end から算出
  });

  it('HTML エスケープされる (タイトルの < >)', () => {
    const html = buildBrochureHtml(baseInput());
    expect(html).toContain('金沢の旅 &lt;test&gt;');
    expect(html).not.toContain('金沢の旅 <test>');
  });

  it('連続スポット間に移動コネクタ (徒歩 + 時間/距離) を差し込む', () => {
    const html = buildBrochureHtml(baseInput());
    expect(html).toContain('徒歩');
    expect(html).toContain('12分');
    expect(html).toContain('850m');
    expect(html).not.toContain('そのほかの移動'); // 突合できたので leftover は無い
  });

  it('突合できない leg は「そのほかの移動」に出る', () => {
    const input = baseInput();
    input.legsByDay = new Map([[
      'd1',
      [{ id: 'lx', day_id: 'd1', from_place_id: 'p2', to_place_id: 'p1', mode: 'driving', duration_sec: 300, distance_m: 1200, fare_text: null, polyline: null, raw_json: null, computed_at: '' }],
    ]]);
    const html = buildBrochureHtml(input);
    expect(html).toContain('そのほかの移動');
  });

  it('画像URL: 相対パスは assetBase 付与 / 外部URLはそのまま', () => {
    const input = baseInput();
    const p1 = input.placeMap.get('p1')!;
    p1.image_url = '/uploads/places/p1/a.jpg';
    const p2 = input.placeMap.get('p2')!;
    p2.image_url = 'https://example.com/b.jpg';
    const html = buildBrochureHtml(input);
    expect(html).toContain('http://127.0.0.1:8090/uploads/places/p1/a.jpg');
    expect(html).toContain('https://example.com/b.jpg');
  });

  it('日程ゼロでも落ちない', () => {
    const html = buildBrochureHtml(baseInput({ days: [], itemsByDay: new Map(), legsByDay: new Map() }));
    expect(html).toContain('日程がまだ登録されていません');
  });
});
