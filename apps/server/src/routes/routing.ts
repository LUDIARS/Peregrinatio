// 経路探索 (Google Routes API)。その日の itinerary_items の place 列を順に結び、
// 連続ペアごとに経路を計算して route_legs を再計算する。
// 旅に出発地点 (自宅/集合地点) があれば、初日の先頭に往路・最終日の末尾に復路を注入する。
// API キー未設定は silent fallback せず 400 で明確にエラーにする ([[feedback_no_silent_fallback]])。
import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';
import { buildRouteWaypoints, type OriginNode } from '../lib/route-waypoints.js';
import { computeRoute } from '@peregrinatio/routing';
import type { RouteLeg, RouteMode, Trip } from '../types.js';

const app = new Hono();

const VALID_MODES: readonly RouteMode[] = ['driving', 'walking', 'transit', 'bicycling'];

interface ItemPlaceRow {
  place_id: string;
  lat: number | null;
  lng: number | null;
}

app.post('/api/days/:id/route', async (c) => {
  const day_id = c.req.param('id');

  if (!config.googleMaps.apiKey) {
    return c.json(
      { error: 'googleMaps.apiKey 未設定: 経路探索を実行できません (data/secrets.local.json を設定してください)' },
      400,
    );
  }

  const b = (await c.req.json().catch(() => ({}))) as { mode?: RouteMode };
  const mode: RouteMode = VALID_MODES.includes(b.mode as RouteMode) ? (b.mode as RouteMode) : 'transit';

  // place_id 非 null の予定を order_index 順に取り、places を join して座標を得る。
  const rows = (await sql`
    SELECT i.place_id AS place_id, p.lat AS lat, p.lng AS lng
    FROM itinerary_items i
    JOIN places p ON p.id = i.place_id
    WHERE i.day_id = ${day_id} AND i.place_id IS NOT NULL
    ORDER BY i.order_index`) as ItemPlaceRow[];

  // lat/lng が揃った place のみを経路ノードにする。
  const placeNodes = rows.filter((r) => r.lat != null && r.lng != null) as Array<{
    place_id: string;
    lat: number;
    lng: number;
  }>;

  // 旅の出発地点を判定: この日が初日(往路)/最終日(復路)なら origin を注入する。
  const origin = await resolveOrigin(day_id);
  const waypoints = buildRouteWaypoints(placeNodes, origin?.node ?? null, {
    isFirstDay: origin?.isFirstDay ?? false,
    isLastDay: origin?.isLastDay ?? false,
  });

  // 既存 leg を入れ替える。
  await sql`DELETE FROM route_legs WHERE day_id = ${day_id}`;

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const from = waypoints[i]!;
    const to = waypoints[i + 1]!;
    const r = await computeRoute(
      { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, mode },
      config.googleMaps.apiKey,
    );
    const raw_json = JSON.stringify(r.raw);
    const computed_at = nowIso();
    const leg: RouteLeg = {
      id: newId(),
      day_id,
      from_place_id: from.place_id,
      to_place_id: to.place_id,
      from_label: from.label,
      to_label: to.label,
      mode,
      duration_sec: r.duration_sec,
      distance_m: r.distance_m,
      fare_text: r.fare_text,
      polyline: r.polyline,
      raw_json,
      computed_at,
    };
    await sql`INSERT INTO route_legs
      (id, day_id, from_place_id, to_place_id, from_label, to_label, mode, duration_sec, distance_m, fare_text, polyline, raw_json, computed_at)
      VALUES (${leg.id}, ${leg.day_id}, ${leg.from_place_id}, ${leg.to_place_id}, ${leg.from_label}, ${leg.to_label},
              ${leg.mode}, ${leg.duration_sec}, ${leg.distance_m}, ${leg.fare_text}, ${leg.polyline}, ${leg.raw_json}, ${leg.computed_at})`;
    legs.push(leg);
  }

  return c.json(legs);
});

/** その日が属する旅の出発地点と、この日が初日/最終日かを返す。出発地点なしは null。 */
async function resolveOrigin(
  dayId: string,
): Promise<{ node: OriginNode; isFirstDay: boolean; isLastDay: boolean } | null> {
  const [meta] = (await sql`
    SELECT trip_id, day_index FROM trip_days WHERE id=${dayId}`) as { trip_id: string; day_index: number }[];
  if (!meta) return null;
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${meta.trip_id}`) as Trip[];
  if (!trip || trip.origin_kind === 'none' || trip.origin_lat == null || trip.origin_lng == null) return null;
  const [range] = (await sql`
    SELECT MIN(day_index) AS minIdx, MAX(day_index) AS maxIdx FROM trip_days WHERE trip_id=${meta.trip_id}`) as {
    minIdx: number;
    maxIdx: number;
  }[];
  if (!range) return null;
  return {
    node: { label: trip.origin_label ?? '出発地点', lat: trip.origin_lat, lng: trip.origin_lng },
    isFirstDay: meta.day_index === range.minIdx,
    isLastDay: meta.day_index === range.maxIdx,
  };
}

app.get('/api/days/:id/route', async (c) => {
  const rows = (await sql`
    SELECT * FROM route_legs WHERE day_id = ${c.req.param('id')} ORDER BY computed_at ASC`) as RouteLeg[];
  return c.json(rows);
});

export default app;
