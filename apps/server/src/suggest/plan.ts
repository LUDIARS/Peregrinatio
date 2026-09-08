// プラン提案の組み立て。旅の材料 → 端点と候補 → 日割り → 見出し。
// DB は読むだけで書かない (採用 API だけが書く)。

import { config } from '../config.js';
import { climateWindowsOfTrip, seasonalHints } from './season.js';
import { buildPlanDays, type PlanAnchor } from './plan-build.js';
import { createTravelEstimator } from './plan-travel.js';
import { resolvePlanReach } from './plan-reach.js';
import { rankAnchors, supplementAnchors, type NewPlaceCandidate } from './plan-anchors.js';
import { buildTransitPlanDays, poolFromAnchors, poolFromNewCandidates } from './plan-transit-build.js';
import { createTransitConnector } from './transit-connect.js';
import { haversineMeters } from '../lib/segment-mode.js';
import { titlePlanDays } from './plan-llm.js';
import type { TripSuggestContext } from './trip-context.js';
import type { PlanReach, PlanStrategy, PlanSuggestInput, PlanSuggestResult } from './types.js';
import type { TripPlace } from '../types.js';

/** 範囲の言い方。駅から算出したのか既定なのかを理由文に出す。 */
export function reachLabel(reach: PlanReach): string {
  if (reach.source === 'manual') return `指定した半径 ${Math.round(reach.radius_m / 1000)}km`;
  if (reach.source === 'default') return `既定の半径 ${Math.round(reach.radius_m / 1000)}km`;
  const farthest = reach.stations[reach.stations.length - 1];
  return farthest
    ? `拠点の最寄り駅から ${farthest.name} まで (約 ${Math.round(reach.radius_m / 1000)}km)`
    : `半径 ${Math.round(reach.radius_m / 1000)}km`;
}

export interface PlanSuggestOptions {
  /** 見出し付けに LLM を使う。false なら「N 日目」のまま返す。 */
  useLlm: boolean;
}

/** 旅の出発地点を端点にする。座標が無ければ端点として使えない。 */
export function originAnchor(ctx: TripSuggestContext): PlanAnchor | null {
  const { trip } = ctx;
  if (trip.origin_kind === 'none' || trip.origin_lat == null || trip.origin_lng == null) return null;
  return {
    label: trip.origin_label ?? (trip.origin_kind === 'home' ? '自宅' : '集合地点'),
    place_id: null,
    point: { lat: trip.origin_lat, lng: trip.origin_lng },
    note: trip.origin_address,
  };
}

/** 拠点 (宿) を端点にする。座標のある拠点の先頭を使う。 */
export function baseAnchor(ctx: TripSuggestContext): PlanAnchor | null {
  const base = ctx.bases.find((b) => b.lat != null && b.lng != null);
  if (!base || base.lat == null || base.lng == null) return null;
  return {
    label: base.base_name ?? base.name,
    place_id: base.id,
    point: { lat: base.lat, lng: base.lng },
    note: null,
    checkin_time: base.checkin_time,
    checkout_time: base.checkout_time,
  };
}

/** 日割りの日付列。旅の日付を優先し、無ければ既存の日、それも無ければ 1 日。 */
export function planDates(ctx: TripSuggestContext): Array<string | null> {
  if (ctx.dates.length > 0) return ctx.dates;
  if (ctx.days.length > 0) return ctx.days.map((d) => d.date);
  return [null];
}

export async function suggestPlan(
  ctx: TripSuggestContext,
  input: PlanSuggestInput,
  options: PlanSuggestOptions,
): Promise<PlanSuggestResult> {
  const warnings: string[] = [];
  const origin = originAnchor(ctx);
  const base = baseAnchor(ctx);
  if (!base) warnings.push('位置情報のある拠点がありません。拠点を設定すると日割りが安定します。');
  if (!origin) warnings.push('出発地点が未設定です。初日の往路と最終日の復路は入っていません。');
  if (ctx.dates.length === 0) warnings.push('旅の開始日・終了日が未設定のため、既存の日数で組みました。');

  const apiKey = config.googleMaps.apiKey;
  if (input.use_routes_api && !apiKey) {
    warnings.push('googleMaps.apiKey が未設定のため、実所要ではなく直線距離からの概算で組みました。');
  }

  const exclude = new Set(input.exclude_place_ids);
  const mustIds = new Set(input.must_place_ids);

  // 拠点周辺だけを候補にする。行き帰りの長距離移動は往路/復路であって「その日に回る場所」ではない。
  const reach = await resolvePlanReach({
    base: base?.point ?? null,
    hops: input.max_station_hops,
    apiKey,
    manualRadiusM: input.reach_radius_m,
  });
  if (reach) warnings.push(...reach.warnings);
  else warnings.push('拠点が無いため、候補を拠点周辺に絞れていません。');

  const nearBase: TripPlace[] = [];
  const outOfReach: PlanSuggestResult['leftovers'] = [];
  for (const place of ctx.places) {
    if (place.is_base === 1 || exclude.has(place.id)) continue;
    if (!reach || !base || place.lat == null || place.lng == null) { nearBase.push(place); continue; }
    const distance = haversineMeters(base.point, { lat: place.lat, lng: place.lng });
    if (distance <= reach.radius_m) { nearBase.push(place); continue; }
    // must 指定は範囲外でも落とさない (ユーザが明示的に行くと決めた場所のため)。
    if (mustIds.has(place.id)) { nearBase.push(place); continue; }
    outOfReach.push({
      place_id: place.id,
      name: place.name,
      reason: `拠点から ${Math.round(distance / 1000)}km で、${reachLabel(reach)}の範囲外のため外しました。`,
    });
  }

  // must 指定を先頭へ寄せる (同スコアなら先に評価される)。
  const candidates = nearBase.sort((a, b) => Number(mustIds.has(b.id)) - Number(mustIds.has(a.id)));

  if (candidates.length === 0) {
    warnings.push(
      outOfReach.length > 0
        ? '拠点の周辺に候補がありません (すべて範囲外でした)。駅数を増やすか、拠点を見直してください。'
        : '日割りに載せる場所がありません。旅に場所を追加してください。',
    );
  }

  const estimator = createTravelEstimator({
    primaryMode: input.primary_mode,
    useRoutesApi: input.use_routes_api && Boolean(apiKey),
    apiKey,
  });

  const dates = planDates(ctx);

  // 沿線で新しく探す (主軸が足りないときの補充)。旅には保存せず提案だけ返す。
  let newPlaces: NewPlaceCandidate[] = [];
  if (base && reach) {
    try {
      newPlaces = await supplementAnchors(
        base.point, reach.radius_m, apiKey, new Set(ctx.places.map((p) => p.name)),
      );
    } catch {
      warnings.push('拠点周辺の候補検索に失敗したため、旅にある場所だけで組みました。');
    }
    if (newPlaces.length === 0 && !apiKey) {
      warnings.push('googleMaps.apiKey が未設定のため、沿線の新しい候補は探していません。');
    }
  }

  // 公共交通が主手段で、拠点と日付が揃っているなら時刻表の実便で組む。
  // 平均速度の概算より、乗れる便があるかどうかのほうが日割りを正しく決める。
  let strategy: PlanStrategy = 'estimate';
  let built: { days: PlanSuggestResult['days']; leftovers: PlanSuggestResult['leftovers'] } | null = null;

  const anchors = rankAnchors(candidates, mustIds);
  const transitUsable = input.primary_mode === 'transit' && base && dates.some((d) => d !== null);

  if (transitUsable && base) {
    const transit = await buildTransitPlanDays(
      {
        input,
        dates,
        base,
        origin,
        pool: [...poolFromAnchors(anchors), ...poolFromNewCandidates(newPlaces)],
        mustIds,
      },
      (gtfsDate) => createTransitConnector({ date: gtfsDate }),
    );
    if (transit.unusable) {
      warnings.push('取り込み済みの時刻表では乗れる便が見つからなかったため、距離からの概算で組みました。GTFS を取り込むと実便で組めます。');
    } else {
      strategy = 'transit_timetable';
      built = { days: transit.days, leftovers: transit.leftovers };
    }
  } else if (input.primary_mode === 'transit') {
    warnings.push('拠点または旅の日付が未設定のため、時刻表ではなく距離からの概算で組みました。');
  }

  if (!built) {
    const estimated = await buildPlanDays(
      { input, dates, origin, base, candidates, mustIds },
      estimator,
    );
    built = { days: estimated.days, leftovers: estimated.leftovers };
    warnings.push(...estimator.warnings());
  }

  const hints = seasonalHints(climateWindowsOfTrip(ctx.trip.start_date, ctx.trip.end_date));

  if (options.useLlm) {
    try {
      for (const t of await titlePlanDays(ctx.trip.title, built.days, hints)) {
        const day = built.days.find((d) => d.day_index === t.day_index);
        if (!day) continue;
        day.title = t.title;
        day.note = t.note;
      }
    } catch {
      // 外部サービス例外には接続先や資格情報が含まれうるため、生メッセージを API 応答へ出さない。
      warnings.push('LLM による見出し付けに失敗したため、既定の見出しのままです。');
    }
  }

  return {
    trip_id: ctx.trip.id,
    input,
    strategy,
    reach,
    days: built?.days ?? [],
    leftovers: [...outOfReach, ...(built?.leftovers ?? [])],
    new_places: newPlaces,
    hints,
    warnings,
  };
}
