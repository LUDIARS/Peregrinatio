import { describe, expect, it } from 'vitest';
import { switchExpressChoice } from './plan-express-switch.js';
import { accessMarkReason } from '../place/AccessMarkChips.js';
import type { ExpressOption, PlanItem, PlanSuggestResult } from '../../types.js';

function item(label: string, direction?: 'outbound' | 'inbound', index = 0, sec = 600): PlanItem {
  return {
    kind: direction ? 'move' : 'visit', place_id: null, label, planned_time: '09:00', note: null,
    mode: direction ? 'transit' : null, duration_sec: sec, distance_m: null,
    duration_source: direction ? 'express_timetable' : null, transit: null,
    ...(direction ? { express_ref: { direction, option_index: index } } : {}),
  };
}

const option = { train_id: 't' } as ExpressOption;

function result(): PlanSuggestResult {
  return {
    trip_id: 'trip', input: {} as PlanSuggestResult['input'], strategy: 'estimate', reach: null,
    days: [{
      day_index: 0, date: '2026-10-17', title: '1 日目', note: null, travel_sec: 1200, stay_sec: 0,
      items: [item('家→駅', 'outbound'), item('なすの401', 'outbound'), item('拠点'), item('宿で休む')],
    }],
    leftovers: [], new_places: [], hints: [], warnings: [],
    express: {
      outbound: [
        { option, items: [item('家→駅', 'outbound'), item('なすの401', 'outbound')] },
        { option, items: [item('家→駅2', 'outbound', 1, 300), item('なすの413', 'outbound', 1, 300)] },
      ],
      inbound: [],
      selected_outbound: 0,
      selected_inbound: null,
    },
  };
}

describe('switchExpressChoice', () => {
  it('同じ方向の行をまるごと差し替え、位置と他の行は保つ', () => {
    const next = switchExpressChoice(result(), 'outbound', 1);
    expect(next.days[0]?.items.map((i) => i.label)).toEqual(['家→駅2', 'なすの413', '拠点', '宿で休む']);
    expect(next.express?.selected_outbound).toBe(1);
    expect(next.days[0]?.travel_sec).toBe(1200 - 1200 + 600);
  });

  it('存在しない候補は何もしない', () => {
    const r = result();
    expect(switchExpressChoice(r, 'outbound', 9)).toBe(r);
  });
});

describe('accessMarkReason', () => {
  it('印ごとの根拠文を作る', () => {
    const marks = {
      taxi_first_fare: { origin_kind: 'station' as const, origin_name: '那須塩原駅', distance_m: 950, threshold_m: 1200 },
      bus_stop_near: { stop_name: '温泉入口', distance_m: 120, source: 'gtfs' as const, radius_m: 300 },
      shuttle_bus: { evidence: '駅から無料送迎', source: 'crawl' as const, source_url: null },
    };
    expect(accessMarkReason(marks, 'taxi_first_fare')).toBe('那須塩原駅から道のり約 950m (初乗り 1.2km 以内)');
    expect(accessMarkReason(marks, 'bus_stop_near')).toContain('温泉入口 まで 120m');
    expect(accessMarkReason(marks, 'shuttle_bus')).toBe('施設サイト: 「駅から無料送迎」');
    expect(accessMarkReason({}, 'shuttle_bus')).toBeNull();
  });
});
