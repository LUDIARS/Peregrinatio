// 場所ごとの滞在時間の見積り (純関数)。
// 「1 日に何件回れるか」は移動時間だけでは決まらず、滞在時間で決まる。
// 種別ごとの標準滞在時間をペースで伸縮させる。

import type { PlanPace } from './types.js';

/** ペース係数。滞在時間に掛ける。 */
export const PACE_FACTOR: Record<PlanPace, number> = {
  relaxed: 1.3,
  standard: 1,
  packed: 0.75,
};

/** 1 日に入れる訪問数の上限。移動が短くても詰め込みすぎないための天井。 */
export const MAX_STOPS_PER_DAY: Record<PlanPace, number> = {
  relaxed: 3,
  standard: 4,
  packed: 6,
};

/** 種別 → 標準滞在時間 (分)。上から順に最初に当たったものを使う。 */
const VISIT_RULES: Array<{ match: RegExp; minutes: number }> = [
  { match: /(テーマパーク|遊園地|amusement|水族館|動物園|zoo|aquarium)/i, minutes: 240 },
  { match: /(スキー|ゲレンデ|海水浴|ビーチ|beach|登山|ハイキング|トレッキング)/i, minutes: 210 },
  { match: /(美術館|博物館|museum|城|庭園|植物園)/i, minutes: 90 },
  { match: /(神社|寺|寺院|shrine|temple|展望|タワー|名所|観光|スポット)/i, minutes: 60 },
  { match: /(温泉|大浴場|スパ|spa|岩盤浴)/i, minutes: 90 },
  { match: /(レストラン|食堂|restaurant|ランチ|ディナー|食事|寿司|焼肉|ラーメン)/i, minutes: 60 },
  { match: /(カフェ|cafe|喫茶|スイーツ)/i, minutes: 45 },
  { match: /(市場|商店街|アウトレット|モール|土産|ショップ|shop|store)/i, minutes: 60 },
  { match: /(駅|station|空港|airport|バスターミナル)/i, minutes: 20 },
];

/** 該当しない場所の既定滞在時間 (分)。 */
export const DEFAULT_VISIT_MINUTES = 60;

/** 場所の標準滞在時間 (分)。名前とカテゴリの両方で照合する。 */
export function baseVisitMinutes(place: { name: string; category: string | null }): number {
  const text = `${place.category ?? ''} ${place.name}`;
  return VISIT_RULES.find((r) => r.match.test(text))?.minutes ?? DEFAULT_VISIT_MINUTES;
}

/** ペースを反映した滞在時間 (分)。15 分刻みに丸め、最低 20 分は確保する。 */
export function visitMinutes(place: { name: string; category: string | null }, pace: PlanPace): number {
  const raw = baseVisitMinutes(place) * PACE_FACTOR[pace];
  return Math.max(20, Math.round(raw / 15) * 15);
}
