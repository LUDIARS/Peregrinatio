// プラン採用 API の実行時入力検証。
// 破壊的な上書きへ進む前に、PlanDay 全体を検証して正規化する。

import { parseHhmm } from './plan-time.js';
import type { PlanDay, PlanItem } from './types.js';

const MAX_DAY_TITLE_LENGTH = 200;
const MAX_DAY_NOTE_LENGTH = 2_000;
const MAX_ITEM_LABEL_LENGTH = 500;
const MAX_ITEM_NOTE_LENGTH = 2_000;
const MAX_ITEMS_PER_DAY = 200;
const MAX_ID_LENGTH = 200;

const KINDS: readonly PlanItem['kind'][] = ['visit', 'move', 'note'];
const MODES = ['driving', 'walking', 'transit', 'bicycling'] as const;
const DURATION_SOURCES = ['routes', 'estimate'] as const;

type PlanAdoptInputResult =
  | { ok: true; days: PlanDay[] }
  | { ok: false; error: string };

function text(value: unknown, maxLength: number, allowNull: true): string | null | undefined;
function text(value: unknown, maxLength: number, allowNull?: false): string | undefined;
function text(value: unknown, maxLength: number, allowNull = false): string | null | undefined {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > maxLength) return undefined;
  return trimmed;
}

function nullableId(value: unknown): string | null | undefined {
  return text(value, MAX_ID_LENGTH, true);
}

function nullableNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseItem(value: unknown): PlanItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !(KINDS as readonly string[]).includes(raw.kind)) return null;

  const kind = raw.kind as PlanItem['kind'];
  const placeId = nullableId(raw.place_id);
  const label = text(raw.label, MAX_ITEM_LABEL_LENGTH);
  const note = raw.note === null ? null : text(raw.note, MAX_ITEM_NOTE_LENGTH);
  const plannedTime = raw.planned_time === null
    ? null
    : typeof raw.planned_time === 'string' && parseHhmm(raw.planned_time) != null
      ? raw.planned_time.trim()
      : undefined;
  const durationSec = nullableNonNegativeInteger(raw.duration_sec);
  const distanceM = nullableNonNegativeInteger(raw.distance_m);
  const mode = raw.mode === null
    ? null
    : typeof raw.mode === 'string' && (MODES as readonly string[]).includes(raw.mode)
      ? raw.mode as PlanItem['mode']
      : undefined;
  const durationSource = raw.duration_source === null
    ? null
    : typeof raw.duration_source === 'string' && (DURATION_SOURCES as readonly string[]).includes(raw.duration_source)
      ? raw.duration_source as PlanItem['duration_source']
      : undefined;

  if (placeId === undefined || !label || note === undefined || plannedTime === undefined
    || durationSec === undefined || distanceM === undefined || mode === undefined || durationSource === undefined) {
    return null;
  }
  if (kind === 'move' ? mode === null || durationSource === null : mode !== null || durationSource !== null) {
    return null;
  }

  return {
    kind,
    place_id: placeId,
    label,
    planned_time: plannedTime,
    note,
    mode,
    duration_sec: durationSec,
    distance_m: distanceM,
    duration_source: durationSource,
  };
}

/**
 * 提案時に使った日付列を許可リストとして、採用する日を検証する。
 * 日付変更後の古い提案や、重複 day_index による二重上書きも拒否する。
 */
export function parsePlanAdoptDays(value: unknown, expectedDates: Array<string | null>): PlanAdoptInputResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: '採用する日がありません' };
  }
  if (value.length > expectedDates.length) {
    return { ok: false, error: '採用する日の数が旅程の日数を超えています' };
  }

  const seen = new Set<number>();
  const days: PlanDay[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: '採用するプランの形式が不正です' };
    }
    const raw = entry as Record<string, unknown>;
    const dayIndex = raw.day_index;
    if (typeof dayIndex !== 'number' || !Number.isSafeInteger(dayIndex)
      || dayIndex < 0 || dayIndex >= expectedDates.length) {
      return { ok: false, error: 'プランの日番号が旅程の範囲外です' };
    }
    const index = dayIndex;
    if (seen.has(index)) return { ok: false, error: '同じ日が複数回指定されています' };
    seen.add(index);
    if (raw.date !== expectedDates[index]) {
      return { ok: false, error: '旅の日付が変わっています。案を作り直してください' };
    }

    const title = text(raw.title, MAX_DAY_TITLE_LENGTH);
    const note = raw.note === null ? null : text(raw.note, MAX_DAY_NOTE_LENGTH);
    const travelSec = nullableNonNegativeInteger(raw.travel_sec);
    const staySec = nullableNonNegativeInteger(raw.stay_sec);
    if (!title || note === undefined || travelSec == null || staySec == null
      || !Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_ITEMS_PER_DAY) {
      return { ok: false, error: '採用するプランの形式が不正です' };
    }

    const items: PlanItem[] = [];
    for (const item of raw.items) {
      const parsed = parseItem(item);
      if (!parsed) return { ok: false, error: '採用する予定の形式が不正です' };
      items.push(parsed);
    }
    days.push({
      day_index: index,
      date: expectedDates[index] ?? null,
      title,
      note,
      items,
      travel_sec: travelSec,
      stay_sec: staySec,
    });
  }
  return { ok: true, days };
}
