// AccessLookups の本番実装 (DB の時刻表・GTFS と Google Places)。
// Places の結果は place_access_cache に 7 日保存し、「見つからなかった」も保存して同じ場所で何度も呼ばない。
// @implements SPEC-ACCESS-TAXI
// @implements SPEC-ACCESS-BUS

import { searchNearbyByTypes } from '@peregrinatio/places';
import { config } from '../config.js';
import { listLocatedStations } from '../express/repository.js';
import { nearbyStopsServing } from '../lib/gtfs-query.js';
import type { GeoPoint } from '../suggest/plan-travel.js';
import { PLACES_CACHE_TTL_MS, readAccessCache, writeAccessCache, type AccessCacheKind } from './cache.js';
import type { AccessLookups, NamedPoint } from './judge.js';
import type { ShuttleExtraction } from './shuttle.js';

const RAIL_ROUTE_TYPES = [0, 1, 2];
const BUS_ROUTE_TYPES = [3];
const STATION_TYPES = ['train_station', 'subway_station', 'light_rail_station'];
const BUS_TYPES = ['bus_stop', 'bus_station'];

interface CachedHit {
  hit: NamedPoint | null;
}

async function placesNearest(
  cacheKey: string,
  kind: AccessCacheKind,
  point: GeoPoint,
  radiusM: number,
  types: string[],
): Promise<NamedPoint | null> {
  const cached = await readAccessCache<CachedHit>(cacheKey, kind, PLACES_CACHE_TTL_MS);
  if (cached) return cached.hit;
  const results = await searchNearbyByTypes(
    { lat: point.lat, lng: point.lng, radius: radiusM, includedTypes: types, maxResults: 3 },
    config.googleMaps.apiKey,
  );
  const first = results.find((r) => r.lat != null && r.lng != null);
  const hit = first && first.lat != null && first.lng != null ? { name: first.name, lat: first.lat, lng: first.lng } : null;
  await writeAccessCache(cacheKey, kind, { hit } satisfies CachedHit);
  return hit;
}

function stopPoints(stops: Array<{ stop_name: string | null; lat: number | null; lng: number | null }>): NamedPoint[] {
  return stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ name: s.stop_name ?? '(名称なし)', lat: s.lat as number, lng: s.lng as number }));
}

/** 1 回の印付け (一覧 1 回ぶん) で使う。新幹線・特急の駅は 1 度だけ読む。 */
export function createAccessLookups(): AccessLookups {
  let express: Promise<NamedPoint[]> | null = null;
  return {
    placesEnabled: Boolean(config.googleMaps.apiKey),
    expressStations() {
      express ??= listLocatedStations().then((rows) => rows.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng })));
      return express;
    },
    async gtfsRailStops(point, radiusM) {
      return stopPoints(await nearbyStopsServing(point.lat, point.lng, radiusM, 5, RAIL_ROUTE_TYPES));
    },
    placesStation: (cacheKey, point, radiusM) => placesNearest(cacheKey, 'station_places', point, radiusM, STATION_TYPES),
    async gtfsBusStops(point, radiusM) {
      return stopPoints(await nearbyStopsServing(point.lat, point.lng, radiusM, 5, BUS_ROUTE_TYPES));
    },
    placesBusStop: (cacheKey, point, radiusM) => placesNearest(cacheKey, 'bus_stop_places', point, radiusM, BUS_TYPES),
    shuttleExtraction: (placeId) => readAccessCache<ShuttleExtraction>(placeId, 'shuttle_llm', null),
  };
}
