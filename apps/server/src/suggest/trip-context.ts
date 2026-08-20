// 提案に必要な旅の材料を DB から 1 回だけ集める。
// 荷物提案 (packing) とプラン提案 (plan) が同じ材料を使うため、収集はここに一本化する。
// 読み取り専用 — この層は DB を書き換えない。

import { sql } from '../db/index.js';
import { enumerateDates } from '../lib/dates.js';
import type { Trip, TripDay, TripPlace } from '../types.js';

/** 設備 1 件 (どの場所のものか / この旅で「やりたい」か)。 */
export interface ContextFacility {
  place_id: string;
  name: string;
  wanted: number;
}

export interface TripSuggestContext {
  trip: Trip;
  /** 泊数。start/end_date が揃わなければ null。 */
  nights: number | null;
  /** 旅の日付列 (start..end)。日付未設定なら空。 */
  dates: string[];
  /** 既存の日 (プラン提案の日数決定に使う)。 */
  days: TripDay[];
  /** 「また今度」でない旅の場所すべて。 */
  places: TripPlace[];
  /** 拠点 (is_base=1)。 */
  bases: TripPlace[];
  facilities: ContextFacility[];
  existingPacking: Array<{ id: string; title: string }>;
}

/** start/end_date から泊数を求める。片方でも欠ければ null。 */
export function nightsOf(trip: Pick<Trip, 'start_date' | 'end_date'>): number | null {
  if (!trip.start_date || !trip.end_date) return null;
  const dates = enumerateDates(trip.start_date, trip.end_date);
  if (dates.length === 0) return null;
  return dates.length - 1;
}

/**
 * ルール照合に使う特徴文字列を組み立てる。
 * 設備名だけでなく、旅の場所の名前とカテゴリも混ぜる
 * (海水浴場やスキー場は「宿の設備」ではなく行き先そのものだから)。
 */
export function featureStrings(ctx: Pick<TripSuggestContext, 'facilities' | 'places'>): string[] {
  const out: string[] = [];
  for (const f of ctx.facilities) out.push(f.name);
  for (const p of ctx.places) {
    out.push(p.name);
    if (p.category) out.push(p.category);
    if (p.summary) out.push(p.summary);
  }
  return out;
}

/** 旅が存在しなければ null。 */
export async function loadTripContext(tripId: string): Promise<TripSuggestContext | null> {
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${tripId}`) as Trip[];
  if (!trip) return null;

  const places = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed
    FROM places p JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${tripId} AND tp.postponed = 0
    ORDER BY tp.is_base DESC, tp.added_at`) as TripPlace[];

  const facilities = (await sql`
    SELECT f.place_id AS place_id, f.name AS name,
           CASE WHEN w.facility_id IS NULL THEN 0 ELSE 1 END AS wanted
    FROM place_facilities f
    JOIN trip_places tp ON tp.place_id = f.place_id AND tp.trip_id = ${tripId}
    LEFT JOIN trip_place_facility_wants w
      ON w.facility_id = f.id AND w.place_id = f.place_id AND w.trip_id = ${tripId}
    ORDER BY f.order_index, f.created_at`) as ContextFacility[];

  const days = (await sql`
    SELECT * FROM trip_days WHERE trip_id=${tripId} ORDER BY day_index`) as TripDay[];

  const existingPacking = (await sql`
    SELECT id, title FROM trip_check_items WHERE trip_id=${tripId} AND list_type='packing'`) as Array<{
      id: string; title: string;
    }>;

  return {
    trip,
    nights: nightsOf(trip),
    dates: trip.start_date && trip.end_date ? enumerateDates(trip.start_date, trip.end_date) : [],
    days,
    places,
    bases: places.filter((p) => p.is_base === 1),
    facilities,
    existingPacking,
  };
}
