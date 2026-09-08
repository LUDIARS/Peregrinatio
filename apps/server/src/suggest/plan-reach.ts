// プランの到達範囲 (拠点周辺のどこまでを候補にするか) を決める。
//
// 「拠点の最寄り駅から 2〜3 駅ぶん」が上限。km を直接指定しないのは、駅の間隔が
// 土地によって桁違いだから — 都市部の 3 駅は数 km、地方の 3 駅は数十 km になる。
// そこで実際の駅の位置から半径を逆算する。
//
// 3 層で解決し、どの層で決まったかを必ず返す (概算を実測のように見せない):
//   gtfs_rail      … 取り込み済みの鉄道系 GTFS から、最寄り駅の N ホップ先までを実測
//   places_station … Places で拠点周辺の鉄道駅を探し、N 番目に近い駅までを実測
//   default        … どちらも使えない。既定半径で絞り、その旨を warning に出す

import { searchPlaces } from '@peregrinatio/places';
import { sql } from '../db/index.js';
import { haversineMeters } from '../lib/segment-mode.js';
import type { GeoPoint } from './plan-travel.js';
import type { PlanReach, ReachStation } from './types.js';

/** 駅から歩いて行ける範囲。駅そのものではなく駅の徒歩圏までを候補にする。 */
export const STATION_WALK_MARGIN_M = 1_500;

/** 駅が見つからなかったときの既定半径。 */
export const DEFAULT_REACH_RADIUS_M = 15_000;

/** 到達半径の下限・上限。駅が極端に近い/遠い土地で範囲が壊れないようにする。 */
export const MIN_REACH_RADIUS_M = 4_000;
export const MAX_REACH_RADIUS_M = 40_000;

/** 鉄道系 GTFS の route_type (0=路面, 1=地下鉄, 2=鉄道)。バス(3)は「駅」として数えない。 */
const RAIL_ROUTE_TYPES = [0, 1, 2];

/** 駅を探す範囲。これより遠い駅は「最寄り駅」とみなさない。 */
const STATION_SEARCH_RADIUS_M = 40_000;

function clampRadius(value: number): number {
  return Math.round(Math.min(MAX_REACH_RADIUS_M, Math.max(MIN_REACH_RADIUS_M, value)));
}

interface RailStop {
  stop_id: string;
  feed_id: string;
  stop_name: string | null;
  lat: number;
  lng: number;
}

/**
 * 停留所の一意キー。feed_id と stop_id は別のフィード間で衝突しうるため連結する。
 * 区切りは gtfs-query.ts の同名ヘルパに合わせる (あちらは非公開のため再実装)。
 */
function stopKey(feedId: string, stopId: string): string {
  return `${feedId}:${stopId}`;
}

/** 鉄道系 route を持つ便に停まる停留所だけを引く (バス停を除く)。 */
async function railStops(): Promise<RailStop[]> {
  const rows = (await sql`
    SELECT DISTINCT s.feed_id AS feed_id, s.stop_id AS stop_id, s.stop_name AS stop_name, s.lat AS lat, s.lng AS lng
    FROM gtfs_stops s
    JOIN gtfs_stop_times st ON st.feed_id = s.feed_id AND st.stop_id = s.stop_id
    JOIN gtfs_trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND r.route_type IN (${RAIL_ROUTE_TYPES[0]}, ${RAIL_ROUTE_TYPES[1]}, ${RAIL_ROUTE_TYPES[2]})`) as Array<{
        feed_id: string; stop_id: string; stop_name: string | null; lat: number | null; lng: number | null;
      }>;
  return rows
    .filter((r): r is RailStop => r.lat != null && r.lng != null)
    .map((r) => ({ ...r, lat: r.lat, lng: r.lng }));
}

/** 同じ便で隣り合う停留所のペア (= 1 駅ぶんの隣接)。 */
async function railAdjacency(): Promise<Map<string, Set<string>>> {
  const rows = (await sql`
    SELECT a.feed_id AS feed_id, a.stop_id AS from_id, b.stop_id AS to_id
    FROM gtfs_stop_times a
    JOIN gtfs_stop_times b
      ON b.feed_id = a.feed_id AND b.trip_id = a.trip_id AND b.stop_sequence = a.stop_sequence + 1
    JOIN gtfs_trips t ON t.feed_id = a.feed_id AND t.trip_id = a.trip_id
    JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    WHERE r.route_type IN (${RAIL_ROUTE_TYPES[0]}, ${RAIL_ROUTE_TYPES[1]}, ${RAIL_ROUTE_TYPES[2]})`) as Array<{
        feed_id: string; from_id: string; to_id: string;
      }>;
  const graph = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = graph.get(a) ?? new Set<string>();
    set.add(b);
    graph.set(a, set);
  };
  for (const row of rows) {
    const from = stopKey(row.feed_id, row.from_id);
    const to = stopKey(row.feed_id, row.to_id);
    link(from, to);
    link(to, from); // 逆方向も 1 駅
  }
  return graph;
}

/** 取り込み済みの鉄道 GTFS から、最寄り駅の hops 先までの駅を集める。 */
export async function reachFromGtfsRail(base: GeoPoint, hops: number): Promise<PlanReach | null> {
  const stops = await railStops();
  if (stops.length === 0) return null;

  const withDistance = stops
    .map((s) => ({ stop: s, distance: haversineMeters(base, { lat: s.lat, lng: s.lng }) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = withDistance[0];
  if (!nearest || nearest.distance > STATION_SEARCH_RADIUS_M) return null;

  const graph = await railAdjacency();
  const key = (s: RailStop) => stopKey(s.feed_id, s.stop_id);
  const byKey = new Map(stops.map((s) => [key(s), s] as const));

  // 最寄り駅から hops ホップまで幅優先で広げる。
  const visited = new Set<string>([key(nearest.stop)]);
  let frontier = [key(nearest.stop)];
  for (let hop = 0; hop < hops; hop += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of graph.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const stations: ReachStation[] = [...visited]
    .map((k) => byKey.get(k))
    .filter((s): s is RailStop => Boolean(s))
    .map((s) => ({
      name: s.stop_name ?? s.stop_id,
      distance_m: Math.round(haversineMeters(base, { lat: s.lat, lng: s.lng })),
    }))
    .sort((a, b) => a.distance_m - b.distance_m);

  const farthest = stations[stations.length - 1];
  if (!farthest) return null;
  return {
    radius_m: clampRadius(farthest.distance_m + STATION_WALK_MARGIN_M),
    source: 'gtfs_rail',
    stations,
    warnings: [],
  };
}

/** 名前・種別から鉄道駅らしいものだけを残す (バス停・道の駅を除く)。 */
export function isRailStationResult(result: { name: string; category?: string | null }): boolean {
  const category = result.category ?? '';
  if (/^(train|subway|light_rail|transit)_station$/.test(category)) return true;
  if (/道の駅|バス停|バスターミナル/.test(result.name)) return false;
  return /駅$/.test(result.name.trim());
}

/** Places で拠点周辺の鉄道駅を探し、hops 番目に近い駅までを半径にする。 */
export async function reachFromPlaces(base: GeoPoint, hops: number, apiKey: string): Promise<PlanReach | null> {
  if (!apiKey) return null;
  const results = await searchPlaces(
    { q: '鉄道駅', lat: base.lat, lng: base.lng, radius: STATION_SEARCH_RADIUS_M },
    apiKey,
  );
  const stations: ReachStation[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.lat == null || r.lng == null || !isRailStationResult(r) || seen.has(r.name)) continue;
    seen.add(r.name);
    const distance = haversineMeters(base, { lat: r.lat, lng: r.lng });
    if (distance > STATION_SEARCH_RADIUS_M) continue;
    stations.push({ name: r.name, distance_m: Math.round(distance) });
  }
  if (stations.length === 0) return null;
  stations.sort((a, b) => a.distance_m - b.distance_m);

  // 最寄り駅を 0 ホップとして hops 先まで。駅が足りなければ一番遠い駅を使う。
  const anchor = stations[Math.min(hops, stations.length - 1)];
  if (!anchor) return null;
  return {
    radius_m: clampRadius(anchor.distance_m + STATION_WALK_MARGIN_M),
    source: 'places_station',
    stations: stations.slice(0, hops + 1),
    warnings: [],
  };
}

export interface ResolveReachOptions {
  base: GeoPoint | null;
  hops: number;
  apiKey: string;
  /** ユーザが半径を直接指定した場合。指定があれば駅の探索はしない。 */
  manualRadiusM: number | null;
}

/**
 * 到達範囲を決める。拠点が無ければ範囲を絞れないので null を返す
 * (絞らないことを呼び側が warning にする)。
 */
export async function resolvePlanReach(options: ResolveReachOptions): Promise<PlanReach | null> {
  if (options.manualRadiusM != null) {
    const radius = clampRadius(options.manualRadiusM);
    return {
      radius_m: radius,
      source: 'manual',
      stations: [],
      // 丸めたことを黙って隠さない。指定と違う半径で組んだなら理由を返す。
      warnings: radius === options.manualRadiusM ? [] : [
        `指定した半径 ${Math.round(options.manualRadiusM / 1000)}km は範囲外のため、`
        + `${Math.round(radius / 1000)}km に丸めました `
        + `(${Math.round(MIN_REACH_RADIUS_M / 1000)}〜${Math.round(MAX_REACH_RADIUS_M / 1000)}km)。`,
      ],
    };
  }
  if (!options.base) return null;

  try {
    const gtfs = await reachFromGtfsRail(options.base, options.hops);
    if (gtfs) return gtfs;
  } catch {
    // GTFS の読み取り失敗で範囲決定を止めない。次の層へ落とす。
  }

  try {
    const places = await reachFromPlaces(options.base, options.hops, options.apiKey);
    if (places) return places;
  } catch {
    // Places の失敗も致命ではない。既定半径へ落とす。
  }

  return {
    radius_m: DEFAULT_REACH_RADIUS_M,
    source: 'default',
    stations: [],
    warnings: [
      `拠点の最寄り駅を特定できなかったため、既定の半径 ${Math.round(DEFAULT_REACH_RADIUS_M / 1000)}km で候補を絞りました。`,
    ],
  };
}
