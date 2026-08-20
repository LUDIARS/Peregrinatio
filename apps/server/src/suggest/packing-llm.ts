// ルールで拾いきれない荷物を LLM に足してもらう補完層。
// ルール側で決まった分を「既に出した」として渡し、重複ではないものだけを求める。
// 失敗しても提案全体は成立させる (ルール由来だけ返す) が、黙って減らさず warning を返す。

import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { config } from '../config.js';
import type { FacilityPackingItem } from './packing-facility-rules.js';

const MAX_LLM_ITEMS = 8;
const MAX_TITLE_LENGTH = 30;
const MAX_CATEGORY_LENGTH = 30;
const MAX_REASON_LENGTH = 200;
const MAX_PROMPT_VALUE_LENGTH = 200;
const MAX_PROMPT_LIST_ITEMS = 30;

export interface PackingLlmInput {
  tripTitle: string;
  seasonLabel: string | null;
  nights: number | null;
  /** 「やりたい」に選ばれた設備を優先して渡す。 */
  facilities: string[];
  placeNames: string[];
  /** ルールが既に出した荷物のタイトル。 */
  alreadySuggested: string[];
}

function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed).slice(0, maxLength).join('') : null;
}

function promptText(value: string): string {
  return Array.from(value).slice(0, MAX_PROMPT_VALUE_LENGTH).join('');
}

function promptList(values: string[]): string {
  return values.slice(0, MAX_PROMPT_LIST_ITEMS).map(promptText).join(', ');
}

function normalizeItem(value: unknown): FacilityPackingItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const title = clampText(raw.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  const reason = clampText(raw.reason, MAX_REASON_LENGTH) ?? 'この旅の内容から必要と判断。';
  const quantity = typeof raw.quantity === 'number' && Number.isSafeInteger(raw.quantity)
    && raw.quantity > 0 && raw.quantity <= 10_000
    ? Math.floor(raw.quantity)
    : null;
  return {
    title,
    category: clampText(raw.category, MAX_CATEGORY_LENGTH) ?? 'その他',
    quantity,
    reason,
  };
}

/** LLM に追加の荷物を尋ねる。呼び出しに失敗したら throw する (呼び側で warning にする)。 */
export async function suggestPackingWithLlm(input: PackingLlmInput): Promise<FacilityPackingItem[]> {
  const raw = await complete({
    model: config.llm.summaryModel,
    system: '旅行の持ち物を検討します。必ず JSON オブジェクト 1 個だけを返してください。一般論ではなく、渡された旅の条件から必要になるものだけを挙げてください。',
    user: [
      `旅の名前: ${promptText(input.tripTitle)}`,
      `季節: ${input.seasonLabel ?? '不明'}`,
      `泊数: ${input.nights ?? '不明'}`,
      `宿・行き先の設備/特徴: ${input.facilities.length > 0 ? promptList(input.facilities) : 'なし'}`,
      `行く場所: ${input.placeNames.length > 0 ? promptList(input.placeNames) : '未定'}`,
      `既に挙がっている持ち物 (これらは挙げないでください): ${promptList(input.alreadySuggested)}`,
      '',
      `items: 上に無くて、この旅の条件から必要になる持ち物を最大 ${MAX_LLM_ITEMS} 件。`,
      '各要素は {"title":"名前","category":"分類","quantity":数量または null,"reason":"なぜ必要か"}。',
      'reason には「この旅のどの条件から必要か」を必ず書いてください。条件と結びつかない一般的な持ち物は出さないでください。',
      '出力例: {"items":[{"title":"防水ポーチ","category":"水まわり","quantity":1,"reason":"川下りがあるため"}]}',
    ].join('\n'),
  });

  const parsed = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
  if (!Array.isArray(parsed.items)) return [];
  const items: FacilityPackingItem[] = [];
  for (const entry of parsed.items) {
    const item = normalizeItem(entry);
    if (item) items.push(item);
    if (items.length >= MAX_LLM_ITEMS) break;
  }
  return items;
}
