// 泊数から決まる基本装備 (純関数)。
// 着替え系は「泊数 + 1 日分」を既定とし、乾燥機などの clothingCap があればそこまで減らす
// (= 「乾燥機あり → 着替えは少なめで」を数量として表現する)。

import type { FacilityPackingItem } from './packing-facility-rules.js';

/** 泊数に比例して増える衣類。cap の対象。 */
const CLOTHING: Array<{ title: string; category: string }> = [
  { title: '着替え (トップス)', category: '衣類' },
  { title: '下着', category: '衣類' },
  { title: '靴下', category: '衣類' },
];

/** 泊数によらず要るもの。 */
const CONSTANT: FacilityPackingItem[] = [
  { title: 'スマホ充電器', category: '電子機器', quantity: 1, reason: 'どの旅でも要る基本装備。' },
  { title: '財布・現金', category: '貴重品', quantity: 1, reason: '現金しか使えない場面が残っているため。' },
  { title: '健康保険証', category: '貴重品', quantity: 1, reason: '旅先で受診する場合に必要。' },
  { title: '常備薬', category: '救急', quantity: null, reason: '飲んでいる薬は現地調達できない。' },
  { title: 'ハンカチ・ティッシュ', category: '衛生', quantity: null, reason: 'どの旅でも要る基本装備。' },
  { title: 'エコバッグ', category: '雑貨', quantity: 1, reason: '土産が増えて荷物が入りきらなくなるため。' },
];

/** 泊数 (null は日帰り扱い) に対する既定の着替え枚数。 */
export function defaultClothingCount(nights: number | null): number {
  if (nights == null || nights <= 0) return 1;
  return nights + 1;
}

/**
 * 基本装備を組み立てる。
 * @param nights 泊数 (null なら日帰り扱い)
 * @param clothingCap 着替えの上限 (乾燥機ルール等)。null なら上限なし。
 */
export function baselineItems(nights: number | null, clothingCap: number | null): FacilityPackingItem[] {
  const base = defaultClothingCount(nights);
  const capped = clothingCap == null ? base : Math.min(base, clothingCap);
  const reason = capped < base
    ? `本来 ${base} 日分だが、現地で洗濯できるので ${capped} 日分に減らせる。`
    : `${nights ?? 0} 泊の旅程に対する目安。`;

  const clothing: FacilityPackingItem[] = CLOTHING.map((c) => ({
    title: c.title,
    category: c.category,
    quantity: capped,
    reason,
  }));
  return [...clothing, ...CONSTANT];
}
