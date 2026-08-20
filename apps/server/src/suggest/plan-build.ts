// 日割りの組み立て (純関数・IO なし)。
// 交通手段から決まる移動時間と、場所ごとの滞在時間の両方が
// その日の活動時間帯に収まる範囲でしか予定を積まない。
//
// 各日の骨格は「出発地点 → 訪問 … → 帰着地点」。
//   初日     : 出発地点 (自宅/集合地点) から出て拠点で終える
//   中日     : 拠点から出て拠点へ戻る
//   最終日   : 拠点 (チェックアウト後) から出て出発地点へ戻る
// 拠点が無い旅では出発地点、それも無ければ最初の候補地を起点にする。

import { estimateTravel, type GeoPoint, type TravelEstimate, type TravelEstimator } from './plan-travel.js';
import { MAX_STOPS_PER_DAY, visitMinutes } from './plan-visit.js';
import { formatHhmm, parseHhmm } from './plan-time.js';
import type { TripPlace } from '../types.js';
import type { PlanDay, PlanItem, PlanSuggestInput } from './types.js';

/** 日の端点。場所なら place_id を持ち、出発地点なら持たない。 */
export interface PlanAnchor {
  label: string;
  place_id: string | null;
  point: GeoPoint;
  note: string | null;
  /** 拠点のときだけ持つ。最終日の開始時刻をチェックアウトで押し下げる。 */
  checkin_time?: string | null;
  checkout_time?: string | null;
}

export interface PlanBuildInput {
  input: PlanSuggestInput;
  /** 日ごとの日付 (null 可)。長さが日数になる。 */
  dates: Array<string | null>;
  origin: PlanAnchor | null;
  base: PlanAnchor | null;
  /** 訪問候補 (座標あり・拠点でない・除外されていない)。must が先頭に来ている前提。 */
  candidates: TripPlace[];
  /** 必ず入れる場所の id。候補選択で優先する。 */
  mustIds: Set<string>;
}

export interface PlanBuildOutput {
  days: PlanDay[];
  leftovers: Array<{ place_id: string; name: string; reason: string }>;
}

function pointOf(place: TripPlace): GeoPoint | null {
  return place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;
}

function moveItem(travel: TravelEstimate, label: string, at: number): PlanItem {
  return {
    kind: 'move',
    place_id: null,
    label,
    planned_time: formatHhmm(at),
    note: null,
    mode: travel.mode,
    duration_sec: travel.duration_sec,
    distance_m: travel.distance_m,
    duration_source: travel.source,
  };
}

function anchorItem(anchor: PlanAnchor, at: number, note: string | null): PlanItem {
  return {
    kind: anchor.place_id ? 'visit' : 'note',
    place_id: anchor.place_id,
    label: anchor.label,
    planned_time: formatHhmm(at),
    note: note ?? anchor.note,
    mode: null,
    duration_sec: null,
    distance_m: null,
    duration_source: null,
  };
}

/** その日の開始/終了の端点を決める。 */
export function anchorsForDay(
  dayIndex: number,
  dayCount: number,
  origin: PlanAnchor | null,
  base: PlanAnchor | null,
  fallback: PlanAnchor,
): { start: PlanAnchor; end: PlanAnchor } {
  const isFirst = dayIndex === 0;
  const isLast = dayIndex === dayCount - 1;
  const start = isFirst ? (origin ?? base ?? fallback) : (base ?? origin ?? fallback);
  const end = isLast ? (origin ?? base ?? fallback) : (base ?? origin ?? fallback);
  return { start, end };
}

/** その日の活動時間帯 (分)。拠点のチェックイン/アウトを反映する。 */
export function dayWindow(
  dayIndex: number,
  dayCount: number,
  input: PlanSuggestInput,
  base: Pick<PlanAnchor, 'checkin_time' | 'checkout_time'> | null,
): { start: number; end: number } {
  const start = parseHhmm(input.day_start) ?? 9 * 60;
  const end = parseHhmm(input.day_end) ?? 18 * 60;
  const checkout = parseHhmm(base?.checkout_time ?? null);
  // 最終日は拠点のチェックアウト後にしか動き出せない。
  const adjustedStart = dayIndex === dayCount - 1 && checkout != null ? Math.max(start, checkout) : start;
  return { start: adjustedStart, end: Math.max(adjustedStart, end) };
}

export async function buildPlanDays(
  build: PlanBuildInput,
  estimator: TravelEstimator,
): Promise<PlanBuildOutput> {
  const { input, dates, origin, base, candidates, mustIds } = build;
  const dayCount = Math.max(1, dates.length);
  // must はペース上限より優先する。時間内に収まる限り、件数上限だけを理由に落とさない。
  const maxStops = Math.max(MAX_STOPS_PER_DAY[input.pace], mustIds.size);

  const remaining = candidates.filter((p) => pointOf(p) !== null);
  const leftovers: PlanBuildOutput['leftovers'] = candidates
    .filter((p) => pointOf(p) === null)
    .map((p) => ({ place_id: p.id, name: p.name, reason: '位置情報が無いため日割りに載せられません。' }));

  const firstPoint = pointOf(remaining[0] ?? ({} as TripPlace));
  const fallbackAnchor: PlanAnchor = {
    label: remaining[0]?.name ?? '出発地点',
    place_id: null,
    point: firstPoint ?? { lat: 0, lng: 0 },
    note: '拠点も出発地点も未設定のため、最初の場所を起点にしています。',
  };

  const days: PlanDay[] = [];

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const { start: startAnchor, end: endAnchor } = anchorsForDay(dayIndex, dayCount, origin, base, fallbackAnchor);
    const window = dayWindow(dayIndex, dayCount, input, base);
    const items: PlanItem[] = [];
    let travelSec = 0;
    let staySec = 0;

    let cursorPoint = startAnchor.point;
    let cursorTime = window.start;
    items.push(anchorItem(startAnchor, cursorTime, dayIndex === 0 ? 'ここから出発' : 'ここから出発 (拠点)'));

    let stops = 0;
    // 選抜は概算 (同期・無料) で行い、採用した区間だけ estimator で確定させる。
    // 全候補を実 API に問い合わせると呼び出しが日数×候補数に膨らむため。
    const rejected = new Set<string>();
    while (stops < maxStops && remaining.length > 0) {
      // 候補ごとに「行って・滞在して・帰着地点まで戻れるか」を評価し、最も早く回れるものを採る。
      // must 指定は距離差に関係なく通常候補より先に採る。
      let best: { index: number; score: number; stayMin: number; must: boolean } | null = null;
      for (const [index, place] of remaining.entries()) {
        const point = pointOf(place);
        if (!point || rejected.has(place.id)) continue;
        const go = estimateTravel(cursorPoint, point, input.primary_mode);
        const stayMin = visitMinutes(place, input.pace);
        const back = estimateTravel(point, endAnchor.point, input.primary_mode);
        const finish = cursorTime + go.duration_sec / 60 + stayMin + back.duration_sec / 60;
        if (finish > window.end) continue;
        const must = mustIds.has(place.id);
        const score = go.duration_sec;
        if (!best || (must && !best.must) || (must === best.must && score < best.score)) {
          best = { index, score, stayMin, must };
        }
      }
      if (!best) break;

      const place = remaining[best.index];
      const point = place ? pointOf(place) : null;
      if (!place || !point) { remaining.splice(best.index, 1); continue; }

      const go = await estimator.estimate(cursorPoint, point);
      const back = await estimator.estimate(point, endAnchor.point);
      const finish = cursorTime + go.duration_sec / 60 + best.stayMin + back.duration_sec / 60;
      if (finish > window.end) {
        // 実所要では収まらなかった。この日はこの候補を諦め、他を探す。
        rejected.add(place.id);
        continue;
      }

      remaining.splice(best.index, 1);
      if (go.duration_sec > 0) {
        items.push(moveItem(go, `${place.name} へ移動`, cursorTime));
        cursorTime += go.duration_sec / 60;
        travelSec += go.duration_sec;
      }

      items.push({
        kind: 'visit',
        place_id: place.id,
        label: place.name,
        planned_time: formatHhmm(cursorTime),
        note: `滞在の目安 ${best.stayMin} 分`,
        mode: null,
        duration_sec: best.stayMin * 60,
        distance_m: null,
        duration_source: null,
      });
      cursorTime += best.stayMin;
      staySec += best.stayMin * 60;
      cursorPoint = point;
      stops += 1;
    }

    const backTravel = await estimator.estimate(cursorPoint, endAnchor.point);
    const back = moveItem(backTravel, `${endAnchor.label} へ移動`, cursorTime);
    if ((back.duration_sec ?? 0) > 0) {
      items.push(back);
      cursorTime += (back.duration_sec ?? 0) / 60;
      travelSec += back.duration_sec ?? 0;
    }
    items.push(anchorItem(endAnchor, cursorTime, dayIndex === dayCount - 1 ? 'ここで解散' : 'ここに戻る (拠点)'));

    days.push({
      day_index: dayIndex,
      date: dates[dayIndex] ?? null,
      title: `${dayIndex + 1} 日目`,
      note: null,
      items,
      travel_sec: travelSec,
      stay_sec: staySec,
    });
  }

  for (const place of remaining) {
    leftovers.push({
      place_id: place.id,
      name: place.name,
      reason: mustIds.has(place.id)
        ? '必須指定ですが活動時間帯に収まらなかったため、この案には入れられませんでした。'
        : '活動時間帯に収まらなかったため、この案では外しました。',
    });
  }

  return { days, leftovers };
}
