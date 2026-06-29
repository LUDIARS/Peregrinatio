// 経路探索 (Google Routes API)。その日の itinerary_items の place 列を順に結び、
// 連続ペアごとに経路を計算して route_legs を再計算する。
// 旅に出発地点 (自宅/集合地点) があれば、初日の先頭に往路・最終日の末尾に復路を注入する。
// API キー未設定は silent fallback せず 400 で明確にエラーにする ([[feedback_no_silent_fallback]])。
import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';
import { buildRouteWaypoints, type OriginNode } from '../lib/route-waypoints.js';
import { suggestSegmentMode, haversineMeters } from '../lib/segment-mode.js';
import { parseGmapsTransit } from '../lib/transit-parse.js';
import { computeRoute } from '@peregrinatio/routing';
import type { RouteLeg, RouteMode, Trip } from '../types.js';

const app = new Hono();

const VALID_MODES: readonly RouteMode[] = ['driving', 'walking', 'transit', 'bicycling'];

interface ItemPlaceRow {
  place_id: string;
  lat: number | null;
  lng: number | null;
}

/** route_segment_modes の 1 行 (区間ごとのユーザ選択 + Google マップ貼り付け解析の保持値)。 */
interface SegmentOverride {
  from_key: string;
  to_key: string;
  mode: RouteMode;
  duration_sec: number | null;
  fare_text: string | null;
  note: string | null;
}

app.post('/api/days/:id/route', async (c) => {
  const day_id = c.req.param('id');

  if (!config.googleMaps.apiKey) {
    return c.json(
      { error: 'googleMaps.apiKey 未設定: 経路探索を実行できません (data/secrets.local.json を設定してください)' },
      400,
    );
  }

  const b = (await c.req.json().catch(() => ({}))) as { mode?: RouteMode; autoPerSegment?: boolean };
  // mode は autoPerSegment=true のとき「最初の移動手段 (primary)」、false のとき全区間共通の手段。
  const mode: RouteMode = VALID_MODES.includes(b.mode as RouteMode) ? (b.mode as RouteMode) : 'transit';
  const autoPerSegment = b.autoPerSegment === true;

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

  // 区間ごとのユーザ選択 (override) を読み込む。並べ替えで route_legs を作り直しても保持される。
  // duration_sec/fare_text/note は Google マップ結果の貼り付け解析 (transit) 由来 (暫定)。
  const overrides = (await sql`
    SELECT from_key, to_key, mode, duration_sec, fare_text, note
    FROM route_segment_modes WHERE day_id = ${day_id}`) as SegmentOverride[];
  const ovMap = new Map(overrides.map((o) => [`${o.from_key}|${o.to_key}`, o]));

  // 既存 leg を入れ替える。
  await sql`DELETE FROM route_legs WHERE day_id = ${day_id}`;

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const from = waypoints[i]!;
    const to = waypoints[i + 1]!;
    // 区間の手段の決め方 (各区間は独立):
    //  1. ユーザがその区間で選んだ手段 (override) があれば最優先で使う。
    //  2. 無ければ autoPerSegment 時に距離+primary からサジェスト (500m以内=徒歩 ほか)。
    const segKey = `${segmentKey(from)}|${segmentKey(to)}`;
    const ov = ovMap.get(segKey);
    const legMode: RouteMode =
      ov?.mode ?? (autoPerSegment ? suggestSegmentMode(haversineMeters(from, to), mode) : mode);

    // Google マップ結果を貼り付け解析した値があれば、それを使う (Google を呼ばない。日本の transit 対策)。
    const hasPasted = !!ov && (ov.duration_sec != null || ov.fare_text != null || ov.note != null);
    let r: { duration_sec: number | null; distance_m: number | null; fare_text: string | null; polyline: string | null; raw: unknown };
    let note: string | null = null;
    if (hasPasted) {
      r = { duration_sec: ov!.duration_sec ?? null, distance_m: null, fare_text: ov!.fare_text ?? null, polyline: null, raw: { source: 'gmaps-paste' } };
      note = ov!.note ?? null;
    } else {
      r = await computeRoute(
        { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, mode: legMode },
        config.googleMaps.apiKey,
      );
    }
    const raw_json = JSON.stringify(r.raw);
    const computed_at = nowIso();
    const leg: RouteLeg = {
      id: newId(),
      day_id,
      from_place_id: from.place_id,
      to_place_id: to.place_id,
      from_label: from.label,
      to_label: to.label,
      mode: legMode,
      duration_sec: r.duration_sec,
      distance_m: r.distance_m,
      fare_text: r.fare_text,
      polyline: r.polyline,
      raw_json,
      note,
      computed_at,
    };
    await sql`INSERT INTO route_legs
      (id, day_id, from_place_id, to_place_id, from_label, to_label, mode, duration_sec, distance_m, fare_text, polyline, raw_json, note, computed_at)
      VALUES (${leg.id}, ${leg.day_id}, ${leg.from_place_id}, ${leg.to_place_id}, ${leg.from_label}, ${leg.to_label},
              ${leg.mode}, ${leg.duration_sec}, ${leg.distance_m}, ${leg.fare_text}, ${leg.polyline}, ${leg.raw_json}, ${leg.note}, ${leg.computed_at})`;
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

/** 区間 (waypoint) のキー。place は place_id、出発/帰着地点 (origin) は '@origin'。 */
function segmentKey(w: { place_id: string | null }): string {
  return w.place_id ?? '@origin';
}

/** leg の端点 (place or origin) の座標を解決する。place は places、origin は trips から。 */
async function endpointCoords(
  dayId: string,
  placeId: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (placeId) {
    const [p] = (await sql`SELECT lat, lng FROM places WHERE id=${placeId}`) as {
      lat: number | null; lng: number | null;
    }[];
    if (!p || p.lat == null || p.lng == null) return null;
    return { lat: p.lat, lng: p.lng };
  }
  // origin 端点: この日が属する旅の出発地点座標。
  const [meta] = (await sql`SELECT trip_id FROM trip_days WHERE id=${dayId}`) as { trip_id: string }[];
  if (!meta) return null;
  const [trip] = (await sql`SELECT origin_lat, origin_lng FROM trips WHERE id=${meta.trip_id}`) as {
    origin_lat: number | null; origin_lng: number | null;
  }[];
  if (!trip || trip.origin_lat == null || trip.origin_lng == null) return null;
  return { lat: trip.origin_lat, lng: trip.origin_lng };
}

/**
 * PATCH /api/legs/:id — 1 つの区間 (leg) の移動手段だけを変更し、その区間のみ再計算する。
 * 他の区間には連動しない (完全独立)。選択は route_segment_modes に保存し、並べ替えで作り直しても保持する。
 */
app.patch('/api/legs/:id', async (c) => {
  const id = c.req.param('id');
  if (!config.googleMaps.apiKey) {
    return c.json({ error: 'googleMaps.apiKey 未設定: 経路探索を実行できません' }, 400);
  }
  const b = (await c.req.json().catch(() => ({}))) as { mode?: RouteMode };
  if (!VALID_MODES.includes(b.mode as RouteMode)) {
    return c.json({ error: 'mode は driving|walking|transit|bicycling のいずれかです' }, 400);
  }
  const mode = b.mode as RouteMode;

  const [leg] = (await sql`SELECT * FROM route_legs WHERE id=${id}`) as RouteLeg[];
  if (!leg) return c.json({ error: 'leg not found' }, 404);

  const from = await endpointCoords(leg.day_id, leg.from_place_id);
  const to = await endpointCoords(leg.day_id, leg.to_place_id);
  if (!from || !to) return c.json({ error: '区間の座標を特定できませんでした' }, 422);

  const r = await computeRoute({ from, to, mode }, config.googleMaps.apiKey);
  const now = nowIso();
  // computed_at は据え置く (GET の並び順キーなので、1 区間更新で順序が崩れないように)。
  // 手段を選び直した = Google で計算し直すので、貼り付け解析の note はクリアする。
  await sql`UPDATE route_legs SET mode=${mode}, duration_sec=${r.duration_sec}, distance_m=${r.distance_m},
    fare_text=${r.fare_text}, polyline=${r.polyline}, raw_json=${JSON.stringify(r.raw)}, note=${null}
    WHERE id=${id}`;

  // この区間の選択を保存 (場所ペアをキーに)。並べ替えで route_legs を作り直しても復元される。
  // 貼り付け解析の保持値 (duration/fare/note) も一緒にクリアする。
  const fromKey = leg.from_place_id ?? '@origin';
  const toKey = leg.to_place_id ?? '@origin';
  await sql`
    INSERT INTO route_segment_modes (id, day_id, from_key, to_key, mode, duration_sec, fare_text, note, updated_at)
    VALUES (${newId()}, ${leg.day_id}, ${fromKey}, ${toKey}, ${mode}, ${null}, ${null}, ${null}, ${now})
    ON CONFLICT(day_id, from_key, to_key) DO UPDATE SET
      mode = excluded.mode, duration_sec = NULL, fare_text = NULL, note = NULL, updated_at = excluded.updated_at`;

  const [updated] = (await sql`SELECT * FROM route_legs WHERE id=${id}`) as RouteLeg[];
  return c.json(updated);
});

/**
 * POST /api/legs/:id/transit-from-gmaps — Google マップの乗換結果テキストを LLM 解析し、
 * この区間に 所要/運賃/乗換要約 を取り込む (暫定。将来 ODPT に置換)。区間ごとに保存し、
 * 並べ替えで route_legs を作り直しても保持する。mode は transit に固定する。
 */
app.post('/api/legs/:id/transit-from-gmaps', async (c) => {
  const id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = (b.text ?? '').trim();
  if (!text) return c.json({ error: 'Google マップの経路結果テキストを貼り付けてください' }, 400);

  const [leg] = (await sql`SELECT * FROM route_legs WHERE id=${id}`) as RouteLeg[];
  if (!leg) return c.json({ error: 'leg not found' }, 404);

  let parsed;
  try {
    parsed = await parseGmapsTransit(text);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '結果の解析に失敗しました' }, 502);
  }

  const now = nowIso();
  // computed_at は据え置き (並び順維持)。distance/polyline は持たない。
  await sql`UPDATE route_legs SET mode=${'transit'}, duration_sec=${parsed.duration_sec},
    distance_m=${null}, fare_text=${parsed.fare_text}, polyline=${null},
    raw_json=${JSON.stringify({ source: 'gmaps-paste' })}, note=${parsed.note} WHERE id=${id}`;

  const fromKey = leg.from_place_id ?? '@origin';
  const toKey = leg.to_place_id ?? '@origin';
  await sql`
    INSERT INTO route_segment_modes (id, day_id, from_key, to_key, mode, duration_sec, fare_text, note, updated_at)
    VALUES (${newId()}, ${leg.day_id}, ${fromKey}, ${toKey}, ${'transit'}, ${parsed.duration_sec}, ${parsed.fare_text}, ${parsed.note}, ${now})
    ON CONFLICT(day_id, from_key, to_key) DO UPDATE SET
      mode = 'transit', duration_sec = excluded.duration_sec, fare_text = excluded.fare_text,
      note = excluded.note, updated_at = excluded.updated_at`;

  const [updated] = (await sql`SELECT * FROM route_legs WHERE id=${id}`) as RouteLeg[];
  return c.json(updated);
});

app.get('/api/days/:id/route', async (c) => {
  const rows = (await sql`
    SELECT * FROM route_legs WHERE day_id = ${c.req.param('id')} ORDER BY computed_at ASC`) as RouteLeg[];
  return c.json(rows);
});

export default app;
