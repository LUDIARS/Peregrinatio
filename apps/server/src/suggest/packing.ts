// 荷物提案の組み立て (ルール → LLM 補完 → 畳み込み)。
// DB は読むだけで書かない。採用は routes/suggest.ts の採用 API が行う。

import { climateWindowsOfTrip, seasonalHints, seasonLabelOfTrip } from './season.js';
import { matchFacilityRules } from './packing-facility-rules.js';
import { matchSeasonRules } from './packing-season-rules.js';
import { buildPackingSuggestions, normalizeTitle } from './packing-merge.js';
import { suggestPackingWithLlm } from './packing-llm.js';
import { featureStrings, type TripSuggestContext } from './trip-context.js';
import type { PackingSuggestResult, PackingSuggestion } from './types.js';

export interface PackingSuggestOptions {
  /** LLM 補完を使う。false ならルールだけで即答する。 */
  useLlm: boolean;
}

/** 設備一覧を「やりたい」優先で並べ、重複を除いた表示用リストにする。 */
function facilityNames(ctx: TripSuggestContext): string[] {
  const sorted = [...ctx.facilities].sort((a, b) => b.wanted - a.wanted);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of sorted) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    out.push(f.name);
  }
  return out;
}

export async function suggestPacking(
  ctx: TripSuggestContext,
  options: PackingSuggestOptions,
): Promise<PackingSuggestResult> {
  const windows = climateWindowsOfTrip(ctx.trip.start_date, ctx.trip.end_date);
  const facilityHits = matchFacilityRules(featureStrings(ctx));
  const seasonRules = matchSeasonRules(windows);

  const built = buildPackingSuggestions({
    nights: ctx.nights,
    facilityHits,
    seasonRules,
    existing: ctx.existingPacking,
  });

  const warnings: string[] = [];
  if (!ctx.trip.start_date) warnings.push('旅の開始日が未設定のため、季節柄の提案を出していません。');
  if (ctx.facilities.length === 0) {
    warnings.push('拠点の設備が未取得です。場所の詳細で「設備を提案」を実行すると、設備由来の荷物が増えます。');
  }

  const suggestions: PackingSuggestion[] = [...built.suggestions];
  if (options.useLlm) {
    const existingKeys = new Set(suggestions.map((s) => s.key));
    const dropKeys = new Set(built.drops.map((d) => normalizeTitle(d.title)));
    try {
      const extra = await suggestPackingWithLlm({
        tripTitle: ctx.trip.title,
        seasonLabel: seasonLabelOfTrip(ctx.trip.start_date, ctx.trip.end_date),
        nights: ctx.nights,
        facilities: facilityNames(ctx),
        placeNames: ctx.places.map((p) => p.name),
        alreadySuggested: suggestions.map((s) => s.title),
      });
      const existingByKey = new Map(ctx.existingPacking.map((e) => [normalizeTitle(e.title), e] as const));
      for (const item of extra) {
        const key = normalizeTitle(item.title);
        if (existingKeys.has(key) || dropKeys.has(key)) continue;
        existingKeys.add(key);
        suggestions.push({
          key,
          title: item.title,
          quantity: item.quantity ?? null,
          category: item.category ?? null,
          reason: item.reason,
          origins: ['この旅の内容'],
          source: 'llm',
          already_listed: existingByKey.has(key),
        });
      }
    } catch {
      // 外部サービス例外には接続先や資格情報が含まれうるため、生メッセージを API 応答へ出さない。
      warnings.push('LLM による補完に失敗したため、ルール由来の提案のみ表示しています。');
    }
  }

  return {
    trip_id: ctx.trip.id,
    nights: ctx.nights,
    season_label: seasonLabelOfTrip(ctx.trip.start_date, ctx.trip.end_date),
    facilities: facilityNames(ctx),
    suggestions,
    drops: built.drops,
    hints: seasonalHints(windows),
    warnings,
  };
}
