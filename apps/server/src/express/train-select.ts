// 乗れる便を選ぶ (端末交通の求め方は注入する。ここは DB を見ない)。
//   往路: 降車駅着 + 端末交通がチェックイン時刻までに収まる便を遅い順に 3 本 + 最も早い便 1 本
//   復路: 拠点を出て乗車駅に着いた後に出る便を早い順に 3 本
// @implements SPEC-EXPRESS-SUGGEST

import { clockToMinutes } from './time-cell.js';
import { serviceDayVerdict, type ServiceDayVerdict } from './service-day.js';
import type { ExpressTrain } from './types.js';

export const OUTBOUND_LATEST_COUNT = 3;
export const INBOUND_COUNT = 3;

export interface TrainSegment {
  train: ExpressTrain;
  depart_time: string;
  arrive_time: string;
  depart_min: number;
  arrive_min: number;
  verdict: ServiceDayVerdict;
}

/** board → alight をこの順に通り、その日に走りうる列車の区間を発時刻順に返す。 */
export function trainSegments(
  trains: readonly ExpressTrain[],
  boardSeq: number,
  alightSeq: number,
  date: string,
): TrainSegment[] {
  const direction = boardSeq < alightSeq ? 'down' : 'up';
  const out: TrainSegment[] = [];
  for (const train of trains) {
    if (train.direction !== direction) continue;
    const verdict = serviceDayVerdict(train.service_note, date);
    if (verdict === 'not_running') continue;
    const board = train.stops.find((s) => s.station_seq === boardSeq);
    const alight = train.stops.find((s) => s.station_seq === alightSeq);
    const departTime = board?.depart_time ?? null;
    const arriveTime = alight?.arrive_time ?? alight?.depart_time ?? null;
    const departMin = clockToMinutes(departTime);
    const arriveMin = clockToMinutes(arriveTime);
    if (departTime == null || arriveTime == null || departMin == null || arriveMin == null || arriveMin < departMin) continue;
    out.push({ train, depart_time: departTime, arrive_time: arriveTime, depart_min: departMin, arrive_min: arriveMin, verdict });
  }
  return out.sort((a, b) => a.depart_min - b.depart_min);
}

/** 端末交通の結果。arrive_min は目的地 (往路=拠点 / 復路=乗車駅) に着く分。 */
export interface TerminalFit<T> {
  arrive_min: number;
  leg: T;
}

export interface SelectedTrain<T> {
  segment: TrainSegment;
  terminal: TerminalFit<T>;
}

/**
 * 往路の候補。降車駅に着いてから端末交通で拠点へ deadlineMin までに着ける便のうち、
 * 遅い順に 3 本と、最も早い便を 1 本 (重複しなければ) 返す。並びは遅い順 → 最後に最早便。
 */
export async function selectOutbound<T>(
  segments: readonly TrainSegment[],
  deadlineMin: number,
  terminalAfter: (arriveMin: number) => Promise<TerminalFit<T> | null>,
): Promise<Array<SelectedTrain<T>>> {
  const fits = async (segment: TrainSegment): Promise<SelectedTrain<T> | null> => {
    if (segment.arrive_min > deadlineMin) return null;
    const terminal = await terminalAfter(segment.arrive_min);
    return terminal && terminal.arrive_min <= deadlineMin ? { segment, terminal } : null;
  };

  const latest: Array<SelectedTrain<T>> = [];
  const byArrivalDesc = [...segments].sort((a, b) => b.arrive_min - a.arrive_min);
  for (const segment of byArrivalDesc) {
    if (latest.length >= OUTBOUND_LATEST_COUNT) break;
    const hit = await fits(segment);
    if (hit) latest.push(hit);
  }
  if (latest.length === 0) return [];

  for (const segment of [...segments].sort((a, b) => a.arrive_min - b.arrive_min)) {
    if (latest.some((s) => s.segment.train.id === segment.train.id)) break;
    const hit = await fits(segment);
    if (hit) { latest.push(hit); break; }
  }
  return latest;
}

/** 復路の候補。乗車駅に readyMin 以降にいられるとき、そこから出る便を早い順に 3 本。 */
export function selectInbound(segments: readonly TrainSegment[], readyMin: number): TrainSegment[] {
  return segments.filter((s) => s.depart_min >= readyMin).slice(0, INBOUND_COUNT);
}
