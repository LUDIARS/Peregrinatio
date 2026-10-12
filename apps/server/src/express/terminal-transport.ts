// 端末交通 (新幹線・特急の駅 ↔ 拠点) を求める。
// 取り込み済みの GTFS で同じフィードに乗れる実便を探し (findStopConnections)、
// 無ければ車 (タクシー) の概算に切り替える。どちらで出したかは leg.source に必ず残す。
// @implements SPEC-EXPRESS-SUGGEST

import { findStopConnections, nearbyStops, type GtfsConnection, type GtfsStopHit } from '../lib/gtfs-query.js';
import { estimateTravel, type GeoPoint } from '../suggest/plan-travel.js';
import { gtfsTimeToMinutes, minutesToSearchTime } from '../suggest/plan-time.js';
import { minutesToClock } from './time-cell.js';
import type { TerminalFit } from './train-select.js';
import type { ExpressTerminalLeg } from './types.js';

/** 列車を降りてからバス・タクシーに乗るまで / 拠点を出てから駅に入るまでの余裕 (分)。 */
export const STATION_TRANSFER_MIN = 10;
const STATION_STOP_RADIUS_M = 900;
const PLACE_STOP_RADIUS_M = 1_200;
const SEARCH_WINDOW_MIN = 180;

export interface TerminalEndpoints {
  station: GeoPoint & { label: string };
  place: GeoPoint & { label: string };
  /** 'YYYYMMDD'。 */
  gtfsDate: string;
}

function byFeed(stops: readonly GtfsStopHit[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of stops) m.set(s.feed_id, [...(m.get(s.feed_id) ?? []), s.stop_id]);
  return m;
}

function serviceLabel(cn: GtfsConnection): string {
  const route = cn.route_name ?? 'バス';
  return `${cn.headsign ? `${route} ${cn.headsign}` : route} (${cn.feed_name})`;
}

export interface TerminalPlanner {
  /** 往路: 駅に arriveMin に着いた後、拠点へ向かう。 */
  toPlace(arriveAtStationMin: number): Promise<TerminalFit<ExpressTerminalLeg> | null>;
  /** 復路: 拠点を leaveMin に出て駅へ向かう。arrive_min は駅に着く分 (乗換の余裕は呼び側)。 */
  toStation(leaveMin: number): Promise<TerminalFit<ExpressTerminalLeg> | null>;
}

/** 駅と拠点の組ごとに 1 つ作る。停留所の近傍探索は 1 回だけ行う。 */
export function createTerminalPlanner(ends: TerminalEndpoints): TerminalPlanner {
  let stopsPromise: Promise<{ station: Map<string, string[]>; place: Map<string, string[]> }> | null = null;
  const stops = () => {
    stopsPromise ??= Promise.all([
      nearbyStops(ends.station.lat, ends.station.lng, STATION_STOP_RADIUS_M, 24),
      nearbyStops(ends.place.lat, ends.place.lng, PLACE_STOP_RADIUS_M, 24),
    ]).then(([station, place]) => ({ station: byFeed(station), place: byFeed(place) }));
    return stopsPromise;
  };

  async function gtfs(fromIsStation: boolean, afterMin: number): Promise<TerminalFit<ExpressTerminalLeg> | null> {
    const { station, place } = await stops();
    const from = fromIsStation ? station : place;
    const to = fromIsStation ? place : station;
    let best: GtfsConnection | null = null;
    for (const [feedId, fromIds] of from) {
      const toIds = to.get(feedId);
      if (!toIds) continue;
      const found = await findStopConnections(feedId, fromIds, toIds, ends.gtfsDate, {
        departureAfter: `${minutesToSearchTime(afterMin)}:00`,
        departureBefore: `${minutesToSearchTime(afterMin + SEARCH_WINDOW_MIN)}:00`,
        limit: 12,
      });
      for (const cn of found) {
        const arr = gtfsTimeToMinutes(cn.arrival_time);
        const bestArr = best ? gtfsTimeToMinutes(best.arrival_time) : null;
        if (arr != null && (bestArr == null || arr < bestArr)) best = cn;
      }
    }
    if (!best) return null;
    const dep = gtfsTimeToMinutes(best.departure_time);
    const arr = gtfsTimeToMinutes(best.arrival_time);
    if (dep == null || arr == null) return null;
    return {
      arrive_min: arr,
      leg: {
        source: 'gtfs', mode: 'bus',
        depart_time: minutesToClock(dep), arrive_time: minutesToClock(arr), duration_min: arr - dep,
        service_label: serviceLabel(best),
        from_label: fromIsStation ? ends.station.label : ends.place.label,
        to_label: fromIsStation ? ends.place.label : ends.station.label,
      },
    };
  }

  function taxi(fromIsStation: boolean, departMin: number): TerminalFit<ExpressTerminalLeg> {
    const est = estimateTravel(fromIsStation ? ends.station : ends.place, fromIsStation ? ends.place : ends.station, 'driving');
    const minutes = Math.ceil(est.duration_sec / 60);
    return {
      arrive_min: departMin + minutes,
      leg: {
        source: 'estimate', mode: 'taxi',
        depart_time: minutesToClock(departMin), arrive_time: minutesToClock(departMin + minutes), duration_min: minutes,
        service_label: null,
        from_label: fromIsStation ? ends.station.label : ends.place.label,
        to_label: fromIsStation ? ends.place.label : ends.station.label,
      },
    };
  }

  return {
    async toPlace(arriveAtStationMin) {
      const after = arriveAtStationMin + STATION_TRANSFER_MIN;
      return (await gtfs(true, after)) ?? taxi(true, after);
    },
    async toStation(leaveMin) {
      return (await gtfs(false, leaveMin)) ?? taxi(false, leaveMin);
    },
  };
}
