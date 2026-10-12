// 旅の往路・復路 (出発地点 ↔ 拠点) の新幹線・特急の便を提案する。DB は読むだけで書かない。
// 時刻表が無い・駅が特定できないときは黙って概算に落とさず、理由を warnings に出して空の候補を返す
// (呼び側は従来の「別手配」メモ行のままにする)。
// @implements SPEC-EXPRESS-SUGGEST

import { haversineMeters, suggestSegmentMode } from '../lib/segment-mode.js';
import { parseHhmm, toGtfsDate } from '../suggest/plan-time.js';
import { estimateTravel, type GeoPoint } from '../suggest/plan-travel.js';
import type { TripSuggestContext } from '../suggest/trip-context.js';
import { getExpressLine, listLocatedStations, listTrains } from './repository.js';
import { isTimetableStale, isWeekend } from './service-day.js';
import { pickStations, type StationPick } from './station-pick.js';
import { createTerminalPlanner, STATION_TRANSFER_MIN } from './terminal-transport.js';
import { minutesToClock } from './time-cell.js';
import { selectInbound, selectOutbound, trainSegments, type TrainSegment } from './train-select.js';
import type { ExpressAccessLeg, ExpressOption, ExpressSuggestResult, ExpressTerminalLeg } from './types.js';

export const DEFAULT_CHECKIN = '15:00';
export const DEFAULT_CHECKOUT = '10:00';

export interface ExpressSuggestOptions {
  /** 復路で拠点を出る時刻 (分)。プラン提案から「最終日の行動が終わって拠点を出る時刻」を渡す。 */
  inboundLeaveMin?: number | null;
}

interface Endpoint extends GeoPoint {
  label: string;
  checkin_time: string | null;
  checkout_time: string | null;
}

/** 拠点 (座標のある先頭)。無ければ旅の最初の場所。 */
export function destinationOf(ctx: TripSuggestContext): Endpoint | null {
  const base = ctx.bases.find((b) => b.lat != null && b.lng != null);
  if (base && base.lat != null && base.lng != null) {
    return { lat: base.lat, lng: base.lng, label: base.base_name ?? base.name, checkin_time: base.checkin_time, checkout_time: base.checkout_time };
  }
  const first = ctx.places.find((p) => p.lat != null && p.lng != null);
  if (first && first.lat != null && first.lng != null) {
    return { lat: first.lat, lng: first.lng, label: first.name, checkin_time: null, checkout_time: null };
  }
  return null;
}

function accessLeg(from: GeoPoint, to: GeoPoint): Omit<ExpressAccessLeg, 'time'> {
  const mode = suggestSegmentMode(haversineMeters(from, to), 'transit');
  const est = estimateTravel(from, to, mode);
  return { source: 'estimate', duration_min: Math.ceil(est.duration_sec / 60), distance_m: est.distance_m };
}

function option(
  direction: ExpressOption['direction'],
  date: string,
  pick: StationPick,
  segment: TrainSegment,
  boardName: string,
  boardSeq: number,
  alightName: string,
  alightSeq: number,
  terminal: ExpressTerminalLeg,
  access: ExpressAccessLeg,
): ExpressOption {
  return {
    source: 'express_timetable', direction, date,
    line_id: pick.line_id, line_name: pick.line_name,
    train_id: segment.train.id, train_name: segment.train.train_name,
    board_station: boardName, board_seq: boardSeq, depart_time: segment.depart_time,
    alight_station: alightName, alight_seq: alightSeq, arrive_time: segment.arrive_time,
    terminal, access,
  };
}

function serviceWarnings(segments: readonly TrainSegment[], date: string, label: string): string[] {
  const out: string[] = [];
  const unknown = [...new Set(segments.filter((s) => s.verdict === 'unknown').map((s) => s.train.service_note))];
  if (unknown.length > 0) out.push(`${label}: 運行日「${unknown.join('・')}」は判定できないため候補に含めています。`);
  const daySpecific = segments.some((s) => s.train.service_note === 'weekday' || s.train.service_note === 'holiday');
  if (daySpecific && !isWeekend(date)) out.push(`${label}: ${date} が祝日なら休日ダイヤの可能性があります (祝日は判定していません)。`);
  return out;
}

export async function suggestExpressForTrip(
  ctx: TripSuggestContext,
  options: ExpressSuggestOptions = {},
): Promise<ExpressSuggestResult> {
  const empty = (warnings: string[]): ExpressSuggestResult => ({ outbound: [], inbound: [], warnings });
  const { trip } = ctx;
  if (trip.origin_kind === 'none' || trip.origin_lat == null || trip.origin_lng == null) {
    return empty(['出発地点が未設定のため、新幹線・特急の往復便は提案していません。']);
  }
  const startDate = trip.start_date;
  const endDate = trip.end_date ?? trip.start_date;
  if (!startDate || !endDate) return empty(['旅の日付が未設定のため、新幹線・特急の往復便は提案していません。']);
  const destination = destinationOf(ctx);
  if (!destination) return empty(['拠点にも場所にも座標が無いため、降車駅を決められません。']);

  const origin: GeoPoint & { label: string } = {
    lat: trip.origin_lat, lng: trip.origin_lng,
    label: trip.origin_label ?? (trip.origin_kind === 'home' ? '自宅' : '集合地点'),
  };
  const picked = pickStations(await listLocatedStations(), origin, destination);
  if (!picked.ok) return empty([`新幹線・特急: ${picked.reason}`]);
  const pick = picked.pick;

  const warnings: string[] = [];
  const line = await getExpressLine(pick.line_id);
  for (const date of new Set([startDate, endDate])) {
    if (line && isTimetableStale(line.valid_from, date)) {
      warnings.push(`${pick.line_name} の時刻表は ${line.valid_from} 時点のものです。ダイヤ改正の可能性があります。`);
      break;
    }
  }
  const trains = await listTrains(pick.line_id);
  const station = (s: StationPick['board']) => ({ lat: s.lat, lng: s.lng, label: `${s.name}駅` });

  // ── 往路 ───────────────────────────────────────────────
  const outbound: ExpressOption[] = [];
  const outSegments = trainSegments(trains, pick.board.seq, pick.alight.seq, startDate);
  warnings.push(...serviceWarnings(outSegments, startDate, '往路'));
  const outGtfs = toGtfsDate(startDate);
  if (outGtfs) {
    const planner = createTerminalPlanner({ station: station(pick.alight), place: destination, gtfsDate: outGtfs });
    const deadline = parseHhmm(destination.checkin_time) ?? parseHhmm(DEFAULT_CHECKIN) ?? 15 * 60;
    const access = accessLeg(origin, pick.board);
    for (const sel of await selectOutbound(outSegments, deadline, (arr) => planner.toPlace(arr))) {
      const leave = sel.segment.depart_min - access.duration_min - STATION_TRANSFER_MIN;
      outbound.push(option('outbound', startDate, pick, sel.segment, pick.board.name, pick.board.seq,
        pick.alight.name, pick.alight.seq, sel.terminal.leg, { ...access, time: minutesToClock(leave) }));
    }
  }
  if (outbound.length === 0) {
    warnings.push(`往路: ${pick.board.name} → ${pick.alight.name} でチェックイン (${destination.checkin_time ?? DEFAULT_CHECKIN}) までに拠点へ着ける便がありません。`);
  }

  // ── 復路 ───────────────────────────────────────────────
  const inbound: ExpressOption[] = [];
  const inSegments = trainSegments(trains, pick.alight.seq, pick.board.seq, endDate);
  warnings.push(...serviceWarnings(inSegments, endDate, '復路'));
  const inGtfs = toGtfsDate(endDate);
  if (inGtfs) {
    const planner = createTerminalPlanner({ station: station(pick.alight), place: destination, gtfsDate: inGtfs });
    const leave = options.inboundLeaveMin
      ?? parseHhmm(destination.checkout_time) ?? parseHhmm(DEFAULT_CHECKOUT) ?? 10 * 60;
    const terminal = await planner.toStation(leave);
    if (terminal) {
      const access = accessLeg(pick.board, origin);
      for (const segment of selectInbound(inSegments, terminal.arrive_min + STATION_TRANSFER_MIN)) {
        inbound.push(option('inbound', endDate, pick, segment, pick.alight.name, pick.alight.seq,
          pick.board.name, pick.board.seq, terminal.leg, { ...access, time: minutesToClock(segment.arrive_min + access.duration_min) }));
      }
    }
  }
  if (inbound.length === 0) {
    warnings.push(`復路: ${pick.alight.name} → ${pick.board.name} で拠点を出た後に乗れる便がありません。`);
  }

  return { outbound, inbound, warnings };
}
