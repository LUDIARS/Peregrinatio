// 提案 (サジェスト) ドメインの共有型。
// 荷物・季節・プランの 3 提案はすべて「プレビュー → 採用」の 2 段で、
// 提案 API は DB を書き換えない。書き込みは採用 API のみが行う。

import type { RouteMode } from '../types.js';

/** 提案の由来。ルール由来か LLM 由来かを UI で区別するために持つ。 */
export type SuggestSource = 'baseline' | 'facility' | 'season' | 'llm';

/** 荷物 1 件の提案。採用時に trip_check_items(list_type='packing') になる。 */
export interface PackingSuggestion {
  /** 安定キー。採用リクエストで候補を指す / 重複判定に使う。 */
  key: string;
  title: string;
  quantity: number | null;
  category: string | null;
  /** 「なぜ持っていくか」。採用時 details に入る。 */
  reason: string;
  /** 由来ラベル (例: 乾燥機 / 秋)。UI のチップ表示用。 */
  origins: string[];
  source: SuggestSource;
  /** 既に持ち物リストに同名がある。UI で既定チェックを外す。 */
  already_listed: boolean;
}

/** 「宿にあるから持っていかなくてよい」もの。荷物を減らす方向の提案。 */
export interface PackingDrop {
  title: string;
  reason: string;
  origins: string[];
  /** 持ち物リストに実在し、削除候補になっている行 (無ければ null)。 */
  existing_item_id: string | null;
}

/** 季節の見どころヒント (荷物ではない読み物。プランのメモにも使う)。 */
export interface SeasonalHint {
  key: string;
  label: string;
  detail: string;
}

/** 荷物提案 API のレスポンス。 */
export interface PackingSuggestResult {
  trip_id: string;
  /** 泊数 (start/end_date から算出。不明なら null)。 */
  nights: number | null;
  /** 判定に使った季節ラベル (例: '秋')。日付不明なら null。 */
  season_label: string | null;
  /** 拠点で「やりたい」に選ばれている設備 + 拠点設備の候補。 */
  facilities: string[];
  suggestions: PackingSuggestion[];
  drops: PackingDrop[];
  hints: SeasonalHint[];
  /** LLM 補完の失敗など、提案が縮退した理由。空なら完全な提案。 */
  warnings: string[];
}

/** 1 日の活動ペース。滞在時間と 1 日に詰める件数に効く。 */
export type PlanPace = 'relaxed' | 'standard' | 'packed';

/** プラン提案の入力 (ユーザが渡す情報)。 */
export interface PlanSuggestInput {
  /** 主たる交通手段。日割りの移動時間はこれを基準に見積もる。 */
  primary_mode: RouteMode;
  /** 1 日の活動開始 'HH:MM'。 */
  day_start: string;
  /** 1 日の活動終了 'HH:MM'。 */
  day_end: string;
  pace: PlanPace;
  /** 必ず入れる場所 (先に配置する)。 */
  must_place_ids: string[];
  /** 使わない場所。 */
  exclude_place_ids: string[];
  /** Routes API で実所要時間を引く (キー必須)。false なら直線距離からの概算。 */
  use_routes_api: boolean;
}

/** 提案されたプランの 1 予定。 */
export interface PlanItem {
  kind: 'visit' | 'move' | 'note';
  place_id: string | null;
  /** 表示名 (place 名 / 出発地点ラベル)。 */
  label: string;
  planned_time: string | null;
  note: string | null;
  /** 移動の場合の手段・所要。visit では null。 */
  mode: RouteMode | null;
  duration_sec: number | null;
  distance_m: number | null;
  /** 所要の出所。'routes'=Routes API 実測 / 'estimate'=直線距離からの概算。 */
  duration_source: 'routes' | 'estimate' | null;
}

/** 提案されたプランの 1 日。 */
export interface PlanDay {
  day_index: number;
  date: string | null;
  title: string;
  /** その日の主眼 (LLM 由来。失敗時は null)。 */
  note: string | null;
  items: PlanItem[];
  /** 移動時間の合計 (秒)。 */
  travel_sec: number;
  /** 滞在時間の合計 (秒)。 */
  stay_sec: number;
}

/** プラン提案 API のレスポンス。DB は書き換わっていない。 */
export interface PlanSuggestResult {
  trip_id: string;
  input: PlanSuggestInput;
  days: PlanDay[];
  /** 日程に載せきれなかった場所 (次の旅 / 予備)。 */
  leftovers: Array<{ place_id: string; name: string; reason: string }>;
  hints: SeasonalHint[];
  warnings: string[];
}
