// プラン提案の入力を検証・正規化する (純関数)。
// 交通手段が提案の軸なので、不正値は既定へ丸めるのではなく既定を明示して受ける。

import type { RouteMode } from '../types.js';
import { parseHhmm } from './plan-time.js';
import type { PlanPace, PlanSuggestInput } from './types.js';

const MODES: readonly RouteMode[] = ['driving', 'walking', 'transit', 'bicycling'];
const PACES: readonly PlanPace[] = ['relaxed', 'standard', 'packed'];
const MAX_PLACE_IDS = 200;
const MAX_PLACE_ID_LENGTH = 200;

/** 拠点の最寄り駅から何駅ぶんまでを候補にするか。既定 3 (= 2〜3 駅の上限側)。 */
export const DEFAULT_STATION_HOPS = 3;
export const MAX_STATION_HOPS = 10;
/** 半径の直接指定を受け付ける範囲 (m)。 */
export const MIN_MANUAL_RADIUS_M = 500;
export const MAX_MANUAL_RADIUS_M = 100_000;

export const DEFAULT_PLAN_INPUT: PlanSuggestInput = {
  primary_mode: 'transit',
  day_start: '09:00',
  day_end: '18:00',
  pace: 'standard',
  must_place_ids: [],
  exclude_place_ids: [],
  use_routes_api: false,
  max_station_hops: DEFAULT_STATION_HOPS,
  reach_radius_m: null,
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || id.length > MAX_PLACE_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PLACE_IDS) break;
  }
  return out;
}

/** 活動時間帯の最小幅 (分)。これを下回る入力は既定に戻す。 */
export const MIN_DAY_WINDOW_MIN = 120;

export function normalizePlanInput(body: unknown): PlanSuggestInput {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const primary_mode = MODES.includes(raw.primary_mode as RouteMode)
    ? (raw.primary_mode as RouteMode)
    : DEFAULT_PLAN_INPUT.primary_mode;
  const pace = PACES.includes(raw.pace as PlanPace) ? (raw.pace as PlanPace) : DEFAULT_PLAN_INPUT.pace;

  const startMin = parseHhmm(typeof raw.day_start === 'string' ? raw.day_start : null);
  const endMin = parseHhmm(typeof raw.day_end === 'string' ? raw.day_end : null);
  const windowOk = startMin != null && endMin != null && endMin - startMin >= MIN_DAY_WINDOW_MIN;

  return {
    primary_mode,
    day_start: windowOk ? (raw.day_start as string) : DEFAULT_PLAN_INPUT.day_start,
    day_end: windowOk ? (raw.day_end as string) : DEFAULT_PLAN_INPUT.day_end,
    pace,
    must_place_ids: stringArray(raw.must_place_ids),
    exclude_place_ids: stringArray(raw.exclude_place_ids),
    use_routes_api: raw.use_routes_api === true,
    max_station_hops: stationHops(raw.max_station_hops),
    reach_radius_m: manualRadius(raw.reach_radius_m),
  };
}

/** 駅数。1 未満・上限超・非整数は既定へ戻す。 */
function stationHops(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return DEFAULT_STATION_HOPS;
  if (value < 1 || value > MAX_STATION_HOPS) return DEFAULT_STATION_HOPS;
  return value;
}

/** 半径の直接指定。範囲外・非数は「指定なし」(= 駅から自動算出) にする。 */
function manualRadius(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < MIN_MANUAL_RADIUS_M || value > MAX_MANUAL_RADIUS_M) return null;
  return Math.round(value);
}
