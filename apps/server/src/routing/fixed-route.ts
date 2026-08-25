import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import type { RouteLeg, RouteMode, TransitKind } from '../types.js';

const ROUTE_MODES: readonly RouteMode[] = ['driving', 'walking', 'transit', 'bicycling'];
const TRANSIT_KINDS: readonly TransitKind[] = ['shinkansen', 'train', 'bus', 'airplane', 'taxi'];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_NOTE_LENGTH = 4_000;

interface FixedRouteInput {
  mode?: unknown;
  transit_kind?: unknown;
  depart_time?: unknown;
  arrive_time?: unknown;
  note?: unknown;
  is_fixed?: unknown;
}

export interface FixedRouteValues {
  mode: RouteMode;
  transitKind: TransitKind | null;
  departTime: string | null;
  arriveTime: string | null;
  note: string | null;
  isFixed: 0 | 1;
}

export class FixedRouteInputError extends Error {}

function optionalText(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new FixedRouteInputError(`${field} は文字列で指定してください`);
  return value.trim() || null;
}

function routeTime(value: unknown, field: string): string | null {
  const text = optionalText(value, field);
  if (text && !TIME_PATTERN.test(text)) {
    throw new FixedRouteInputError(`${field} は HH:MM 形式で指定してください`);
  }
  return text;
}

/** @implements SPEC-FIXED-ROUTE-SAVE */
export function parseFixedRouteInput(input: unknown): FixedRouteValues {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FixedRouteInputError('リクエスト本文はオブジェクトで指定してください');
  }
  const body = input as FixedRouteInput;
  if (!ROUTE_MODES.includes(body.mode as RouteMode)) {
    throw new FixedRouteInputError('mode は driving|walking|transit|bicycling のいずれかです');
  }
  const mode = body.mode as RouteMode;
  const transitKind = optionalText(body.transit_kind, 'transit_kind');
  if (transitKind && !TRANSIT_KINDS.includes(transitKind as TransitKind)) {
    throw new FixedRouteInputError('transit_kind は shinkansen|train|bus|airplane|taxi のいずれかです');
  }
  if (mode !== 'transit' && transitKind) {
    throw new FixedRouteInputError('transit_kind は mode=transit の区間だけ指定できます');
  }
  const note = optionalText(body.note, 'note');
  if (note && note.length > MAX_NOTE_LENGTH) {
    throw new FixedRouteInputError(`note は ${MAX_NOTE_LENGTH} 文字以内で指定してください`);
  }
  if (typeof body.is_fixed !== 'boolean') {
    throw new FixedRouteInputError('is_fixed は boolean で指定してください');
  }
  if (body.is_fixed && mode === 'transit' && !transitKind) {
    throw new FixedRouteInputError('確定する公共交通の種類を指定してください');
  }
  return {
    mode,
    transitKind: mode === 'transit' ? transitKind as TransitKind | null : null,
    departTime: routeTime(body.depart_time, 'depart_time'),
    arriveTime: routeTime(body.arrive_time, 'arrive_time'),
    note,
    isFixed: body.is_fixed ? 1 : 0,
  };
}

/** @implements SPEC-FIXED-ROUTE-PERSISTENCE — save a leg and its reorder-resistant override atomically. */
export async function saveFixedRoute(leg: RouteLeg, input: unknown): Promise<RouteLeg> {
  const values = parseFixedRouteInput(input);
  const now = nowIso();
  const fromKey = leg.from_place_id ?? '@origin';
  const toKey = leg.to_place_id ?? '@origin';
  const modeChanged = values.mode !== leg.mode;
  const durationSec = modeChanged ? null : leg.duration_sec;
  const distanceM = modeChanged ? null : leg.distance_m;
  const fareText = modeChanged ? null : leg.fare_text;
  const polyline = modeChanged ? null : leg.polyline;
  const rawJson = modeChanged ? JSON.stringify({ source: 'manual-fixed' }) : leg.raw_json;

  await sql.begin(async (tx) => {
    await tx`UPDATE route_legs SET mode=${values.mode}, transit_kind=${values.transitKind},
      depart_time=${values.departTime}, arrive_time=${values.arriveTime}, note=${values.note},
      is_fixed=${values.isFixed}, duration_sec=${durationSec}, distance_m=${distanceM},
      fare_text=${fareText}, polyline=${polyline}, raw_json=${rawJson}
      WHERE id=${leg.id}`;
    await tx`
      INSERT INTO route_segment_modes
        (id, day_id, from_key, to_key, mode, duration_sec, fare_text, depart_time, arrive_time,
         note, transit_kind, is_fixed, updated_at)
      VALUES (${newId()}, ${leg.day_id}, ${fromKey}, ${toKey}, ${values.mode}, ${durationSec},
              ${fareText}, ${values.departTime}, ${values.arriveTime}, ${values.note},
              ${values.transitKind}, ${values.isFixed}, ${now})
      ON CONFLICT(day_id, from_key, to_key) DO UPDATE SET
        mode = excluded.mode, duration_sec = excluded.duration_sec, fare_text = excluded.fare_text,
        depart_time = excluded.depart_time, arrive_time = excluded.arrive_time,
        note = excluded.note, transit_kind = excluded.transit_kind,
        is_fixed = excluded.is_fixed, updated_at = excluded.updated_at`;
  });

  const [updated] = (await sql`SELECT * FROM route_legs WHERE id=${leg.id}`) as RouteLeg[];
  if (!updated) throw new Error('保存した区間を読み戻せませんでした');
  return updated;
}
