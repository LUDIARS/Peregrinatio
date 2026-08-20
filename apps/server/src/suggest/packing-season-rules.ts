// 気候ウィンドウ (season.ts) → 荷物への効果 (純データ)。
// 「夏 = 日避け」「秋 = 紅葉」のような季節柄の支度をここに集約する。

import type { ClimateWindow } from './season.js';
import type { FacilityPackingItem } from './packing-facility-rules.js';

export interface SeasonPackingRule {
  window: ClimateWindow;
  /** 由来ラベル (UI のチップ)。 */
  label: string;
  add: FacilityPackingItem[];
}

export const SEASON_PACKING_RULES: SeasonPackingRule[] = [
  {
    window: 'heat',
    label: '猛暑',
    add: [
      { title: '日焼け止め', category: '肌', quantity: 1, reason: '日中の屋外行程が長いため。' },
      { title: '帽子', category: '日避け', quantity: 1, reason: '直射日光を避けて消耗を抑える。' },
      { title: '日傘', category: '日避け', quantity: 1, reason: '待ち時間の日陰を自前で作る。' },
      { title: 'サングラス', category: '日避け', quantity: 1, reason: '照り返しがきつい時期のため。' },
      { title: '冷感タオル', category: '日避け', quantity: 1, reason: '首元を冷やすと体感が大きく変わる。' },
      { title: '経口補水液・塩分タブレット', category: '食事', quantity: null, reason: '汗で失う分を補う。水だけでは足りない。' },
      { title: '虫よけスプレー', category: '肌', quantity: 1, reason: '夕方の屋外で刺されやすい時期。' },
    ],
  },
  {
    window: 'autumn_leaves',
    label: '紅葉',
    add: [
      { title: '羽織もの (薄手)', category: '衣類', quantity: 1, reason: '紅葉期は朝晩と日中の寒暖差が大きい。' },
      { title: 'カメラ・予備バッテリー', category: '電子機器', quantity: 1, reason: '紅葉の撮影で電池の減りが早い。' },
      { title: '歩きやすい靴', category: '靴', quantity: 1, reason: '紅葉の名所は坂と砂利道が多い。' },
      { title: '小さめのライト', category: '安全', quantity: 1, reason: '日没が早く、下山・帰路が暗くなる。' },
    ],
  },
  {
    window: 'cold',
    label: '厳寒',
    add: [
      { title: '防寒アウター', category: '衣類', quantity: 1, reason: '朝晩の冷え込みに備える。' },
      { title: '手袋・マフラー', category: '衣類', quantity: 1, reason: '屋外の待ち時間対策。' },
      { title: 'カイロ', category: '防寒', quantity: 4, reason: '屋外行程が続く日の保険。' },
      { title: 'リップクリーム・保湿', category: '肌', quantity: 1, reason: '乾燥で荒れやすい時期。' },
    ],
  },
  {
    window: 'snow',
    label: '降雪',
    add: [
      { title: '防水の靴・靴用滑り止め', category: '靴', quantity: 1, reason: '積雪と路面凍結に備える。' },
      { title: '替えの靴下', category: '衣類', quantity: 2, reason: '濡れたまま歩くと一日が台無しになる。' },
    ],
  },
  {
    window: 'rainy',
    label: '梅雨',
    add: [
      { title: '折りたたみ傘', category: '雨具', quantity: 1, reason: '降水確率が高い時期。' },
      { title: 'レインウェア', category: '雨具', quantity: 1, reason: '両手を空けたい移動日用。' },
      { title: '防水バッグカバー', category: '雨具', quantity: 1, reason: '荷物の水濡れを防ぐ。' },
      { title: '替えの靴下', category: '衣類', quantity: 2, reason: '靴が濡れる前提で。' },
    ],
  },
  {
    window: 'typhoon',
    label: '台風',
    add: [
      { title: 'モバイルバッテリー', category: '電子機器', quantity: 1, reason: '交通の乱れで移動が長引くことがある。' },
      { title: '行程の代替メモ', category: '記録', quantity: null, reason: '運休時に振り替える先を決めておく。' },
    ],
  },
  {
    window: 'pollen',
    label: '花粉',
    add: [
      { title: 'マスク', category: '衛生', quantity: 3, reason: '飛散期の屋外行程に備える。' },
      { title: '目薬', category: '衛生', quantity: 1, reason: '屋外が続くと目に来る。' },
    ],
  },
  {
    window: 'cherry_blossom',
    label: '桜',
    add: [
      { title: 'レジャーシート', category: 'アクティビティ', quantity: 1, reason: '花見の座り場所に使う。' },
      { title: '羽織もの (薄手)', category: '衣類', quantity: 1, reason: '花見の時期は夕方から急に冷える。' },
    ],
  },
];

/** 気候ウィンドウの一覧から、当てはまるルールを引く。 */
export function matchSeasonRules(windows: ClimateWindow[]): SeasonPackingRule[] {
  return SEASON_PACKING_RULES.filter((r) => windows.includes(r.window));
}
