// ルール群の出力を 1 本の提案リストに畳む (純関数)。
// 同じ荷物が複数の由来から出る (例: 「日焼け止め」= 猛暑 + スキー) ため、
// タイトルで正規化して束ね、由来ラベルを合流させ、数量は多い方を採る。

import type { FacilityPackingItem, FacilityPackingRule } from './packing-facility-rules.js';
import type { SeasonPackingRule } from './packing-season-rules.js';
import { baselineItems } from './packing-baseline.js';
import type { PackingDrop, PackingSuggestion, SuggestSource } from './types.js';

/** 比較用のタイトル正規化。全半角・大小・空白・括弧書きの差を吸収する。 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s・,、.。/／-]/g, '')
    .trim();
}

interface Accumulator {
  title: string;
  category: string | null;
  quantity: number | null;
  reasons: string[];
  origins: string[];
  source: SuggestSource;
}

const SOURCE_RANK: Record<SuggestSource, number> = { facility: 0, season: 1, baseline: 2, llm: 3 };

function push(
  map: Map<string, Accumulator>,
  item: FacilityPackingItem,
  origin: string,
  source: SuggestSource,
): void {
  const key = normalizeTitle(item.title);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      title: item.title,
      category: item.category ?? null,
      quantity: item.quantity ?? null,
      reasons: [item.reason],
      origins: [origin],
      source,
    });
    return;
  }
  // 由来が増えるほど「持っていくべき」度が上がる。数量は多い方を採る。
  if (!existing.origins.includes(origin)) existing.origins.push(origin);
  if (!existing.reasons.includes(item.reason)) existing.reasons.push(item.reason);
  if (item.quantity != null && (existing.quantity == null || item.quantity > existing.quantity)) {
    existing.quantity = item.quantity;
  }
  if (SOURCE_RANK[source] < SOURCE_RANK[existing.source]) existing.source = source;
}

export interface BuildPackingInput {
  nights: number | null;
  facilityHits: Array<{ rule: FacilityPackingRule; matched: string[] }>;
  seasonRules: SeasonPackingRule[];
  /** 既存の持ち物 (重複表示と削除候補の突き合わせ用)。 */
  existing: Array<{ id: string; title: string }>;
}

export interface BuildPackingOutput {
  suggestions: PackingSuggestion[];
  drops: PackingDrop[];
  /** 適用された着替えの上限。null なら上限なし。 */
  clothingCap: number | null;
}

/** 設備ルールから着替え上限を求める。複数あれば最も厳しい (小さい) 値。 */
export function resolveClothingCap(hits: Array<{ rule: FacilityPackingRule }>): number | null {
  const caps = hits.map((h) => h.rule.clothingCap).filter((c): c is number => typeof c === 'number');
  return caps.length > 0 ? Math.min(...caps) : null;
}

export function buildPackingSuggestions(input: BuildPackingInput): BuildPackingOutput {
  const clothingCap = resolveClothingCap(input.facilityHits);
  const map = new Map<string, Accumulator>();

  // 設備 → 季節 → 基本装備 の順に積む。先に入った由来が代表 source になる。
  for (const hit of input.facilityHits) {
    for (const item of hit.rule.add ?? []) push(map, item, hit.rule.label, 'facility');
  }
  for (const rule of input.seasonRules) {
    for (const item of rule.add) push(map, item, rule.label, 'season');
  }
  for (const item of baselineItems(input.nights, clothingCap)) push(map, item, '基本', 'baseline');

  const existingByKey = new Map(input.existing.map((e) => [normalizeTitle(e.title), e] as const));

  const suggestions: PackingSuggestion[] = [...map.entries()]
    .map(([key, acc]) => ({
      key,
      title: acc.title,
      quantity: acc.quantity,
      category: acc.category,
      reason: acc.reasons.join(' '),
      origins: acc.origins,
      source: acc.source,
      already_listed: existingByKey.has(key),
    }))
    .sort((a, b) =>
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
      || (a.category ?? '').localeCompare(b.category ?? '', 'ja')
      || a.title.localeCompare(b.title, 'ja'));

  // 現地にあるので不要なもの。提案リストに残っていたらそちらを消す。
  const dropMap = new Map<string, PackingDrop>();
  for (const hit of input.facilityHits) {
    for (const drop of hit.rule.drop ?? []) {
      const key = normalizeTitle(drop.title);
      const found = dropMap.get(key);
      if (found) {
        if (!found.origins.includes(hit.rule.label)) found.origins.push(hit.rule.label);
        continue;
      }
      dropMap.set(key, {
        title: drop.title,
        reason: drop.reason,
        origins: [hit.rule.label],
        existing_item_id: existingByKey.get(key)?.id ?? null,
      });
    }
  }
  const drops = [...dropMap.values()];
  const dropKeys = new Set(dropMap.keys());

  return {
    suggestions: suggestions.filter((s) => !dropKeys.has(s.key)),
    drops,
    clothingCap,
  };
}
