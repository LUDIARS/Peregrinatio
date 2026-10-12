// 新幹線・特急の往復便をプランの行に変える (純関数)。
// 「別手配」のメモ行の代わりに、出発地点 → 乗車駅 / 列車 / 降車駅 → 拠点 の 3 行を置く。
// 候補便ごとに行の組を作っておき、画面で別の候補へ差し替えられるようにする。
// @implements SPEC-EXPRESS-PLAN

import { clockToMinutes } from '../express/time-cell.js';
import type { ExpressOption, ExpressSuggestResult } from '../express/types.js';
import type { PlanAnchor } from './plan-build.js';
import type { PlanExpressChoice, PlanExpressSummary, PlanItem } from './types.js';

/** 初日・最終日に差し込む往復の行と、日中の行動に効く時刻。 */
export interface PlanExpressBookends {
  outbound: {
    items: PlanItem[];
    /** 拠点に着いて動き出せる分。 */
    ready_min: number;
  } | null;
  inbound: {
    items: PlanItem[];
  } | null;
  summary: PlanExpressSummary;
}

function minutesBetween(from: string, to: string): number {
  const a = clockToMinutes(from);
  const b = clockToMinutes(to);
  return a == null || b == null ? 0 : Math.max(0, b - a);
}

/** 24 時を超える時刻はプランの 'HH:MM' に載らないので 23:59 で止める (表示用。便の時刻は note に残す)。 */
function planTime(clock: string): string {
  const m = clockToMinutes(clock);
  if (m == null) return clock;
  const v = Math.min(23 * 60 + 59, m);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function trainItem(o: ExpressOption, index: number): PlanItem {
  const summary = `${o.line_name} ${o.train_name} ${o.board_station} → ${o.alight_station}`;
  return {
    kind: 'move',
    place_id: null,
    label: summary,
    planned_time: planTime(o.depart_time),
    note: `${o.depart_time} 発 → ${o.arrive_time} 着 (新幹線・特急の時刻表)`,
    mode: 'transit',
    duration_sec: minutesBetween(o.depart_time, o.arrive_time) * 60,
    distance_m: null,
    duration_source: 'express_timetable',
    transit: {
      summary, departure_time: o.depart_time, arrival_time: o.arrive_time,
      transfer_count: 0, walk_from_m: 0, walk_to_m: 0,
    },
    express_ref: { direction: o.direction, option_index: index },
  };
}

function terminalItem(o: ExpressOption, index: number): PlanItem {
  const t = o.terminal;
  const how = t.source === 'gtfs' ? `バス ${t.service_label ?? ''}`.trim() : 'タクシー (車の概算)';
  return {
    kind: 'move',
    place_id: null,
    label: `${t.from_label} → ${t.to_label} (${how})`,
    planned_time: planTime(t.depart_time),
    note: `${t.depart_time} → ${t.arrive_time}`,
    mode: t.mode === 'bus' ? 'transit' : 'driving',
    duration_sec: t.duration_min * 60,
    distance_m: null,
    duration_source: t.source === 'gtfs' ? 'gtfs' : 'estimate',
    transit: t.source === 'gtfs'
      ? {
          summary: t.service_label ?? 'バス', departure_time: t.depart_time, arrival_time: t.arrive_time,
          transfer_count: 0, walk_from_m: 0, walk_to_m: 0,
        }
      : null,
    express_ref: { direction: o.direction, option_index: index },
  };
}

function accessItem(o: ExpressOption, index: number, originLabel: string): PlanItem {
  const outbound = o.direction === 'outbound';
  return {
    kind: 'move',
    place_id: null,
    label: outbound ? `${originLabel} → ${o.board_station}駅` : `${o.alight_station}駅 → ${originLabel}`,
    planned_time: planTime(outbound ? o.access.time : o.arrive_time),
    note: outbound
      ? `${o.access.time} に出発 (駅まで約 ${o.access.duration_min} 分の概算 + 乗車の余裕)`
      : `${o.access.time} ごろ到着 (駅から約 ${o.access.duration_min} 分の概算)`,
    mode: 'transit',
    duration_sec: o.access.duration_min * 60,
    distance_m: o.access.distance_m,
    duration_source: 'estimate',
    transit: null,
    express_ref: { direction: o.direction, option_index: index },
  };
}

/** 往路は 出発地点→乗車駅 / 列車 / 降車駅→拠点、復路は 拠点→乗車駅 / 列車 / 降車駅→出発地点。 */
export function expressItems(o: ExpressOption, index: number, originLabel: string): PlanItem[] {
  return o.direction === 'outbound'
    ? [accessItem(o, index, originLabel), trainItem(o, index), terminalItem(o, index)]
    : [terminalItem(o, index), trainItem(o, index), accessItem(o, index, originLabel)];
}

function choices(options: readonly ExpressOption[], originLabel: string): PlanExpressChoice[] {
  return options.map((option, index) => ({ option, items: expressItems(option, index, originLabel) }));
}

/** 提案の先頭候補を採る。候補が無い方向は null (従来の「別手配」メモ行のまま)。 */
export function buildExpressBookends(result: ExpressSuggestResult, origin: PlanAnchor): PlanExpressBookends {
  const outboundChoices = choices(result.outbound, origin.label);
  const inboundChoices = choices(result.inbound, origin.label);
  const firstOut = outboundChoices[0];
  const firstIn = inboundChoices[0];
  const ready = firstOut ? clockToMinutes(firstOut.option.terminal.arrive_time) : null;
  return {
    outbound: firstOut && ready != null ? { items: firstOut.items, ready_min: ready } : null,
    inbound: firstIn ? { items: firstIn.items } : null,
    summary: {
      outbound: outboundChoices,
      inbound: inboundChoices,
      selected_outbound: firstOut ? 0 : null,
      selected_inbound: firstIn ? 0 : null,
    },
  };
}
