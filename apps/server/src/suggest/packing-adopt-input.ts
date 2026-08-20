// 荷物採用 API の実行時入力検証。
// 追加と削除を始める前に全件を検証し、途中失敗による部分反映を防ぐ。

import type { PackingAdoptItem } from './packing-adopt.js';

const MAX_ITEMS = 200;
const MAX_REMOVALS = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_REASON_LENGTH = 2_000;
const MAX_ID_LENGTH = 200;
const MAX_QUANTITY = 10_000;

type PackingAdoptInputResult =
  | { ok: true; items: PackingAdoptItem[]; removeItemIds: string[] }
  | { ok: false; error: string };

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > maxLength) return undefined;
  return trimmed;
}

export function parsePackingAdoptInput(body: Record<string, unknown>): PackingAdoptInputResult {
  const rawItems = body.items === undefined ? [] : body.items;
  const rawRemovals = body.remove_item_ids === undefined ? [] : body.remove_item_ids;
  if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS
    || !Array.isArray(rawRemovals) || rawRemovals.length > MAX_REMOVALS) {
    return { ok: false, error: '採用する持ち物の形式が不正です' };
  }

  const items: PackingAdoptItem[] = [];
  for (const entry of rawItems) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: '採用する持ち物の形式が不正です' };
    }
    const raw = entry as Record<string, unknown>;
    const title = optionalText(raw.title, MAX_TITLE_LENGTH);
    const category = optionalText(raw.category, MAX_CATEGORY_LENGTH);
    const reason = optionalText(raw.reason, MAX_REASON_LENGTH);
    const quantity = raw.quantity === undefined || raw.quantity === null
      ? null
      : typeof raw.quantity === 'number' && Number.isSafeInteger(raw.quantity)
        && raw.quantity > 0 && raw.quantity <= MAX_QUANTITY
        ? raw.quantity
        : undefined;
    if (!title || category === undefined || reason === undefined || quantity === undefined) {
      return { ok: false, error: '採用する持ち物の形式が不正です' };
    }
    items.push({ title, category, reason, quantity });
  }

  const removeItemIds: string[] = [];
  const seenIds = new Set<string>();
  for (const value of rawRemovals) {
    if (typeof value !== 'string') return { ok: false, error: '削除する持ち物 ID の形式が不正です' };
    const id = value.trim();
    if (!id || id.length > MAX_ID_LENGTH) return { ok: false, error: '削除する持ち物 ID の形式が不正です' };
    if (!seenIds.has(id)) {
      seenIds.add(id);
      removeItemIds.push(id);
    }
  }

  if (items.length === 0 && removeItemIds.length === 0) {
    return { ok: false, error: '採用する持ち物がありません' };
  }
  return { ok: true, items, removeItemIds };
}
