// プラン提案の入力を検証・正規化する (純関数)。
// 交通手段が提案の軸なので、不正値は既定へ丸めるのではなく既定を明示して受ける。

import type { RouteMode } from '../types.js';
import { parseHhmm } from './plan-time.js';
import type { PlanPace, PlanSuggestInput } from './types.js';

const MODES: readonly RouteMode[] = ['driving', 'walking', 'transit', 'bicycling'];
const PACES: readonly PlanPace[] = ['relaxed', 'standard', 'packed'];
const MAX_PLACE_IDS = 200;
const MAX_PLACE_ID_LENGTH = 200;

export const DEFAULT_PLAN_INPUT: PlanSuggestInput = {
  primary_mode: 'transit',
  day_start: '09:00',
  day_end: '18:00',
  pace: 'standard',
  must_place_ids: [],
  exclude_place_ids: [],
  use_routes_api: false,
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
  };
}
