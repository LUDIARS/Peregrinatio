// プラン提案の組み立て。旅の材料 → 端点と候補 → 日割り → 見出し。
// DB は読むだけで書かない (採用 API だけが書く)。

import { config } from '../config.js';
import { climateWindowsOfTrip, seasonalHints } from './season.js';
import { buildPlanDays, type PlanAnchor } from './plan-build.js';
import { createTravelEstimator } from './plan-travel.js';
import { titlePlanDays } from './plan-llm.js';
import type { TripSuggestContext } from './trip-context.js';
import type { PlanSuggestInput, PlanSuggestResult } from './types.js';

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
  const candidates = ctx.places
    .filter((p) => p.is_base === 0 && !exclude.has(p.id))
    // must 指定を先頭へ寄せる (同スコアなら先に評価される)。
    .sort((a, b) => Number(mustIds.has(b.id)) - Number(mustIds.has(a.id)));

  if (candidates.length === 0) warnings.push('日割りに載せる場所がありません。旅に場所を追加してください。');

  const estimator = createTravelEstimator({
    primaryMode: input.primary_mode,
    useRoutesApi: input.use_routes_api && Boolean(apiKey),
    apiKey,
  });

  const built = await buildPlanDays(
    { input, dates: planDates(ctx), origin, base, candidates, mustIds },
    estimator,
  );
  warnings.push(...estimator.warnings());

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
    days: built.days,
    leftovers: built.leftovers,
    hints,
    warnings,
  };
}
