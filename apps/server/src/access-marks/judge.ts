// 候補 1 件のアクセス印を決める。外部・DB の問い合わせは AccessLookups に注入する
// (GTFS を先に見て、見つからないときだけ Places を呼ぶ、という順序をここで固定する)。
// @implements SPEC-ACCESS-TAXI
// @implements SPEC-ACCESS-BUS
// @implements SPEC-ACCESS-SHUTTLE

import { haversineMeters } from '../lib/segment-mode.js';
import type { GeoPoint } from '../suggest/plan-travel.js';
import { judgeShuttleBus, type ShuttleExtraction } from './shuttle.js';
import { judgeTaxiFirstFare, type TaxiOrigin } from './taxi.js';
import type { AccessCandidate, AccessMarks } from './types.js';

/** 候補から「最寄り駅」とみなす範囲。 */
export const STATION_SEARCH_RADIUS_M = 3_000;
/** バス停の徒歩圏。 */
export const BUS_STOP_RADIUS_M = 300;

export interface NamedPoint extends GeoPoint {
  name: string;
}

export interface AccessLookups {
  /** 取り込み済みの新幹線・特急の駅 (座標あり)。 */
  expressStations(): Promise<NamedPoint[]>;
  /** 鉄道 GTFS (route_type 0/1/2) の停留所で、point から radius 以内のもの。 */
  gtfsRailStops(point: GeoPoint, radiusM: number): Promise<NamedPoint[]>;
  /** Places の鉄道駅 (キー未設定なら呼ばれない)。 */
  placesStation(cacheKey: string, point: GeoPoint, radiusM: number): Promise<NamedPoint | null>;
  /** バス GTFS (route_type 3) の停留所で、point から radius 以内のもの。 */
  gtfsBusStops(point: GeoPoint, radiusM: number): Promise<NamedPoint[]>;
  /** Places のバス停 (キー未設定なら呼ばれない)。 */
  placesBusStop(cacheKey: string, point: GeoPoint, radiusM: number): Promise<NamedPoint | null>;
  /** 施設サマリーのクロール→LLM が抽出したシャトルの有無。 */
  shuttleExtraction(placeId: string): Promise<ShuttleExtraction | null>;
  /** Places を使えるか (Google Maps API キーの有無)。 */
  placesEnabled: boolean;
}

function nearest(point: GeoPoint, list: readonly NamedPoint[], radiusM: number): (NamedPoint & { distance_m: number }) | null {
  let best: (NamedPoint & { distance_m: number }) | null = null;
  for (const p of list) {
    const d = Math.round(haversineMeters(point, p));
    if (d <= radiusM && (!best || d < best.distance_m)) best = { ...p, distance_m: d };
  }
  return best;
}

const PLACES_FAILED = 'Places の問い合わせに失敗したため調べきれていません';

/**
 * 最寄り駅: 新幹線・特急の駅 → 鉄道 GTFS → Places の順で、3km 以内の最も近いもの。
 * Places の失敗は「駅が無い」と区別するため failed=true で返す。
 */
export async function nearestStation(
  c: AccessCandidate,
  lookups: AccessLookups,
): Promise<{ station: NamedPoint | null; failed: boolean }> {
  const point = { lat: c.lat, lng: c.lng };
  const express = nearest(point, await lookups.expressStations(), STATION_SEARCH_RADIUS_M);
  if (express) return { station: express, failed: false };
  const rail = nearest(point, await lookups.gtfsRailStops(point, STATION_SEARCH_RADIUS_M), STATION_SEARCH_RADIUS_M);
  if (rail) return { station: rail, failed: false };
  if (!lookups.placesEnabled) return { station: null, failed: false };
  try {
    const places = await lookups.placesStation(c.cache_key, point, STATION_SEARCH_RADIUS_M);
    return { station: places ? nearest(point, [places], STATION_SEARCH_RADIUS_M) : null, failed: false };
  } catch (e) {
    console.warn('[access-marks] Places の駅検索に失敗:', e instanceof Error ? e.message : e);
    return { station: null, failed: true };
  }
}

export async function judgeAccessMarks(
  c: AccessCandidate,
  base: TaxiOrigin | null,
  thresholdM: number,
  lookups: AccessLookups,
): Promise<AccessMarks> {
  const marks: AccessMarks = {};
  const point = { lat: c.lat, lng: c.lng };

  const unchecked: NonNullable<AccessMarks['unchecked']> = {};
  const { station, failed: stationFailed } = await nearestStation(c, lookups);
  const origins: TaxiOrigin[] = [];
  if (base) origins.push(base);
  if (station) origins.push({ kind: 'station', name: `${station.name.replace(/駅$/, '')}駅`, point: station });
  const taxi = judgeTaxiFirstFare(point, origins, thresholdM);
  if (taxi) marks.taxi_first_fare = taxi;
  else if (stationFailed) unchecked.taxi_first_fare = `最寄り駅の${PLACES_FAILED}`;

  const gtfsBus = nearest(point, await lookups.gtfsBusStops(point, BUS_STOP_RADIUS_M), BUS_STOP_RADIUS_M);
  if (gtfsBus) {
    marks.bus_stop_near = { stop_name: gtfsBus.name, distance_m: gtfsBus.distance_m, source: 'gtfs', radius_m: BUS_STOP_RADIUS_M };
  } else if (lookups.placesEnabled) {
    try {
      const hit = await lookups.placesBusStop(c.cache_key, point, BUS_STOP_RADIUS_M);
      const near = hit ? nearest(point, [hit], BUS_STOP_RADIUS_M) : null;
      if (near) marks.bus_stop_near = { stop_name: near.name, distance_m: near.distance_m, source: 'places', radius_m: BUS_STOP_RADIUS_M };
    } catch (e) {
      console.warn('[access-marks] Places のバス停検索に失敗:', e instanceof Error ? e.message : e);
      unchecked.bus_stop_near = `バス停の${PLACES_FAILED}`;
    }
  }

  if (c.texts) {
    const shuttle = judgeShuttleBus(c.texts, await lookups.shuttleExtraction(c.texts.place_id));
    if (shuttle) marks.shuttle_bus = shuttle;
  }
  if (Object.keys(unchecked).length > 0) marks.unchecked = unchecked;
  return marks;
}
