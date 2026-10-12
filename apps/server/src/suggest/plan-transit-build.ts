// 時刻表の実便で日割りを組む。
//
// 組み方は「主軸を先に置いて、そこへの経路を逆算する」:
//   1. 主軸候補をスコア順に並べる (気になる場所・半日仕事の場所・調べた場所)
//   2. 上から順に「今いる場所から実際に乗れる便があるか」「その日のうちに拠点へ戻れるか」を確かめる
//   3. 両方満たすものだけを置き、時計を実便の到着時刻まで進める
// 拠点へ戻れない候補はその日から外す — 戻れない予定は予定ではない。
//
// 長距離の往路・復路 (出発地点↔拠点) はローカルの GTFS では追えない。取り込んだ新幹線・特急の
// 時刻表から便が引けていればその行 (express) を置き、無ければ別手配のメモ行として置く。
// @implements SPEC-EXPRESS-PLAN

import { visitMinutes } from './plan-visit.js';
import { dayWindow, type PlanAnchor } from './plan-build.js';
import { formatHhmm, toGtfsDate } from './plan-time.js';
import type { TransitConnector } from './transit-connect.js';
import type { GeoPoint } from './plan-travel.js';
import type { AnchorScore, NewPlaceCandidate } from './plan-anchors.js';
import type { PlanDay, PlanItem, PlanSuggestInput } from './types.js';
import type { PlanExpressBookends } from './plan-express.js';
import { MAX_STOPS_PER_DAY } from './plan-visit.js';

/** 停留所までの徒歩と待ちの余裕 (分)。前の予定が終わってすぐ発車には乗れない。 */
export const BOARDING_BUFFER_MIN = 10;

/** 日割りに載せる候補 1 件 (旅の場所と、提案だけの新規候補を同じ形で扱う)。 */
export interface PoolEntry {
  /** 旅の場所なら place_id。提案だけの新規候補は null。 */
  place_id: string | null;
  name: string;
  point: GeoPoint;
  category: string | null;
  /** 主軸として先に置く候補か。 */
  is_anchor: boolean;
  /** まだ旅に無い提案候補か。 */
  is_new: boolean;
  /** 主軸に選んだ理由 (UI 表示用)。 */
  reason: string;
}

export interface TransitPlanInput {
  input: PlanSuggestInput;
  /** 日ごとの日付 ('YYYY-MM-DD')。GTFS は運行日を見るため日付必須。 */
  dates: Array<string | null>;
  base: PlanAnchor;
  origin: PlanAnchor | null;
  pool: PoolEntry[];
  mustIds: Set<string>;
  /** 新幹線・特急の往復便。無い方向は別手配のメモ行になる。 */
  express?: PlanExpressBookends | null;
}

export interface TransitPlanOutput {
  days: PlanDay[];
  leftovers: Array<{ place_id: string; name: string; reason: string }>;
  /** 実便が 1 本も引けず、この方式では組めなかった。 */
  unusable: boolean;
}

/** 旅の場所から日割り候補を作る。 */
export function poolFromAnchors(anchors: readonly AnchorScore[]): PoolEntry[] {
  const pool: PoolEntry[] = [];
  for (const a of anchors) {
    if (a.place.lat == null || a.place.lng == null) continue;
    pool.push({
      place_id: a.place.id,
      name: a.place.name,
      point: { lat: a.place.lat, lng: a.place.lng },
      category: a.place.category,
      is_anchor: a.score > 0,
      is_new: false,
      reason: a.reason,
    });
  }
  return pool;
}

/** Places で補った新規候補を日割り候補に混ぜる。 */
export function poolFromNewCandidates(candidates: readonly NewPlaceCandidate[]): PoolEntry[] {
  return candidates.map((c) => ({
    place_id: null,
    name: c.name,
    point: { lat: c.lat, lng: c.lng },
    category: c.category,
    is_anchor: true,
    is_new: true,
    reason: `拠点周辺の${c.found_by}として見つけた候補 (まだ旅に入っていません)`,
  }));
}

function visitItem(entry: PoolEntry, at: number, stayMin: number, pace: PlanSuggestInput['pace']): PlanItem {
  const notes = [`滞在の目安 ${stayMin} 分`];
  if (entry.is_new) notes.push('旅にまだ無い提案候補');
  if (entry.is_anchor && entry.reason) notes.push(entry.reason);
  return {
    kind: 'visit',
    place_id: entry.place_id,
    label: entry.name,
    planned_time: formatHhmm(at),
    note: notes.join(' / '),
    mode: null,
    duration_sec: stayMin * 60,
    distance_m: null,
    duration_source: null,
    transit: null,
  };
}

function anchorItem(anchor: PlanAnchor, at: number, note: string): PlanItem {
  return {
    kind: anchor.place_id ? 'visit' : 'note',
    place_id: anchor.place_id,
    label: anchor.label,
    planned_time: formatHhmm(at),
    note,
    mode: null,
    duration_sec: null,
    distance_m: null,
    duration_source: null,
    transit: null,
  };
}

function moveItem(label: string, departMin: number, arriveMin: number, leg: PlanItem['transit']): PlanItem {
  return {
    kind: 'move',
    place_id: null,
    label,
    planned_time: formatHhmm(departMin),
    note: leg ? `${leg.summary} (${leg.departure_time} → ${leg.arrival_time})` : null,
    mode: 'transit',
    duration_sec: Math.max(0, Math.round((arriveMin - departMin) * 60)),
    distance_m: null,
    duration_source: 'gtfs',
    transit: leg,
  };
}

function sumDuration(items: readonly PlanItem[]): number {
  return items.reduce((sum, item) => sum + (item.duration_sec ?? 0), 0);
}

/**
 * 実便で日割りを組む。1 本も便が引けなければ unusable=true を返し、
 * 呼び側が概算方式へ切り替える (黙って概算に落ちない)。
 */
export async function buildTransitPlanDays(
  build: TransitPlanInput,
  connectorFor: (gtfsDate: string) => TransitConnector,
): Promise<TransitPlanOutput> {
  const { input, dates, base, origin, pool, mustIds } = build;
  const express = build.express ?? null;
  const dayCount = Math.max(1, dates.length);
  const maxStops = Math.max(MAX_STOPS_PER_DAY[input.pace], mustIds.size);

  const days: PlanDay[] = [];
  const remaining = [...pool];
  const unreachable = new Map<string, string>();
  let anyConnection = false;

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const date = dates[dayIndex] ?? null;
    const gtfsDate = toGtfsDate(date);
    const window = dayWindow(dayIndex, dayCount, input, base);
    const items: PlanItem[] = [];
    let travelSec = 0;
    let staySec = 0;

    // 長距離の往路は時刻表の便があればそれを置き、拠点に着いてから動き出す。無ければ別手配のメモ行。
    let dayStart = window.start;
    if (dayIndex === 0 && express?.outbound) {
      items.push(...express.outbound.items);
      travelSec += sumDuration(express.outbound.items);
      dayStart = Math.max(window.start, express.outbound.ready_min);
    } else if (dayIndex === 0 && origin) {
      items.push({
        kind: 'note', place_id: null, label: `${origin.label} から ${base.label} へ`,
        planned_time: null, note: '長距離の往路は別手配 (新幹線・高速バス等)',
        mode: null, duration_sec: null, distance_m: null, duration_source: null, transit: null,
      });
    }

    let cursor: GeoPoint = base.point;
    let t = dayStart;
    items.push(anchorItem(base, t, 'ここから出発 (拠点)'));

    if (gtfsDate) {
      const connector = connectorFor(gtfsDate);
      const rejected = new Set<string>();
      let stops = 0;

      while (stops < maxStops) {
        let chosen: { index: number; entry: PoolEntry; departMin: number; arriveMin: number; leg: PlanItem['transit']; stayMin: number } | null = null;

        for (const [index, entry] of remaining.entries()) {
          const key = entry.place_id ?? entry.name;
          if (rejected.has(key)) continue;

          const go = await connector.depart(cursor, entry.point, t + BOARDING_BUFFER_MIN);
          if (!go) { rejected.add(key); unreachable.set(key, '公共交通で行ける便が見つかりませんでした。'); continue; }
          anyConnection = true;

          const stayMin = visitMinutes({ name: entry.name, category: entry.category }, input.pace);
          const leaveMin = go.arrive_min + stayMin;
          // 「その日のうちに拠点へ戻れるか」を先に確かめる。戻れない予定は置かない。
          const back = await connector.arriveBy(entry.point, base.point, window.end);
          if (!back || back.depart_min < leaveMin) {
            rejected.add(key);
            unreachable.set(key, back
              ? `滞在後の最終便 (${back.leg.departure_time} 発) に間に合わず、その日のうちに拠点へ戻れません。`
              : 'その日のうちに拠点へ戻る便がありません。');
            continue;
          }

          chosen = { index, entry, departMin: go.depart_min, arriveMin: go.arrive_min, leg: go.leg, stayMin };
          break; // pool は主軸スコア順。最初に成立したものがその時点の主軸。
        }

        if (!chosen) break;

        remaining.splice(chosen.index, 1);
        items.push(moveItem(`${chosen.entry.name} へ移動`, chosen.departMin, chosen.arriveMin, chosen.leg));
        travelSec += Math.max(0, (chosen.arriveMin - chosen.departMin) * 60);
        items.push(visitItem(chosen.entry, chosen.arriveMin, chosen.stayMin, input.pace));
        staySec += chosen.stayMin * 60;
        t = chosen.arriveMin + chosen.stayMin;
        cursor = chosen.entry.point;
        stops += 1;
      }

      if (stops > 0) {
        const back = await connector.depart(cursor, base.point, t)
          ?? await connector.arriveBy(cursor, base.point, window.end);
        if (back) {
          items.push(moveItem(`${base.label} へ戻る`, back.depart_min, back.arrive_min, back.leg));
          travelSec += Math.max(0, (back.arrive_min - back.depart_min) * 60);
          t = back.arrive_min;
        }
      }
    }

    const isLast = dayIndex === dayCount - 1;
    const inbound = isLast ? express?.inbound ?? null : null;
    items.push(anchorItem(base, t, !isLast ? 'ここに戻る (拠点)' : inbound ? 'ここから復路' : 'ここで解散 (復路は別手配)'));

    if (inbound) {
      items.push(...inbound.items);
      travelSec += sumDuration(inbound.items);
    } else if (isLast && origin) {
      items.push({
        kind: 'note', place_id: null, label: `${base.label} から ${origin.label} へ`,
        planned_time: null, note: '長距離の復路は別手配 (新幹線・高速バス等)',
        mode: null, duration_sec: null, distance_m: null, duration_source: null, transit: null,
      });
    }

    days.push({
      day_index: dayIndex,
      date,
      title: `${dayIndex + 1} 日目`,
      note: null,
      items,
      travel_sec: travelSec,
      stay_sec: staySec,
    });
  }

  const leftovers = remaining
    .filter((entry) => entry.place_id !== null)
    .map((entry) => ({
      place_id: entry.place_id as string,
      name: entry.name,
      reason: unreachable.get(entry.place_id ?? entry.name)
        ?? '活動時間帯に収まらなかったため、この案では外しました。',
    }));

  return { days, leftovers, unusable: !anyConnection };
}
