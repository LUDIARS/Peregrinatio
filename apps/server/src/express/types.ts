// 新幹線・特急の時刻表ライブラリの共有型。
// 時刻表は旅をまたいで共有する (場所ライブラリと同じ考え方)。旅ごとの区間ボード
// (timetables / timetable_departures) とは別物で、採用したときだけ区間ボードへ写す。
// @implements SPEC-EXPRESS-LIBRARY

export type ExpressLineKind = 'shinkansen' | 'limited_express';
export type ExpressDirection = 'down' | 'up';

export const EXPRESS_LINE_KINDS: readonly ExpressLineKind[] = ['shinkansen', 'limited_express'];
export const EXPRESS_DIRECTIONS: readonly ExpressDirection[] = ['down', 'up'];

/** 運行日の種別。'daily' / 'weekday' / 'holiday' 以外は自由文 (判定できないので warnings に出す)。 */
export type ExpressServiceNote = 'daily' | 'weekday' | 'holiday' | (string & {});

export interface ExpressLine {
  id: string;
  name: string;
  kind: ExpressLineKind;
  operator: string | null;
  source_url: string | null;
  /** ダイヤの有効開始日 'YYYY-MM-DD' (不明なら null)。 */
  valid_from: string | null;
  notes: string | null;
  imported_at: string;
}

/** 路線上の停車駅。seq は下り方向の並び順 (0 始まり)。 */
export interface ExpressStation {
  line_id: string;
  seq: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface ExpressStopTime {
  station_seq: number;
  /** 'HH:MM' (24:xx 可)。始発駅など着時刻が無ければ null。 */
  arrive_time: string | null;
  /** 'HH:MM' (24:xx 可)。終着駅など発時刻が無ければ null。 */
  depart_time: string | null;
}

export interface ExpressTrain {
  id: string;
  line_id: string;
  direction: ExpressDirection;
  train_name: string;
  service_note: ExpressServiceNote;
  /** 停車駅の時刻 (通過駅は含まない)。進行順。 */
  stops: ExpressStopTime[];
}

/** 一覧用: 路線 + 駅数・列車数。 */
export interface ExpressLineSummary extends ExpressLine {
  station_count: number;
  train_count: number;
}

/** 詳細: 路線 + 駅 + 列車 (時刻付き)。 */
export interface ExpressLineDetail extends ExpressLine {
  stations: ExpressStation[];
  trains: ExpressTrain[];
}

// ── 取り込み (プレビュー → 保存) ─────────────────────────────────────────────

/** 取り込みの路線情報 (id/imported_at は保存時に決まる)。 */
export interface ExpressImportLine {
  name: string;
  kind: ExpressLineKind;
  operator: string | null;
  source_url: string | null;
  valid_from: string | null;
  notes: string | null;
}

export interface ExpressImportStation {
  seq: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface ExpressImportTrain {
  direction: ExpressDirection;
  train_name: string;
  service_note: ExpressServiceNote;
  stops: ExpressStopTime[];
}

/** プレビューと保存で同じ形を往復させる。 */
export interface ExpressImportPayload {
  line: ExpressImportLine;
  stations: ExpressImportStation[];
  trains: ExpressImportTrain[];
  warnings: string[];
}

// ── 便の提案 ────────────────────────────────────────────────────────────────

/** 端末交通 (駅 ↔ 拠点) の手段と所要。GTFS の実便が引ければ 'gtfs'、無ければ車の概算 (タクシー想定)。 */
export interface ExpressTerminalLeg {
  source: 'gtfs' | 'estimate';
  /** 'bus' (GTFS 実便) / 'taxi' (概算)。 */
  mode: 'bus' | 'taxi';
  /** 'HH:MM'。 */
  depart_time: string;
  arrive_time: string;
  duration_min: number;
  /** GTFS 実便なら「系統 行先 (フィード名)」、概算なら null。 */
  service_label: string | null;
  from_label: string;
  to_label: string;
}

/** 出発地点 ↔ 乗車駅の移動 (概算)。 */
export interface ExpressAccessLeg {
  source: 'estimate';
  duration_min: number;
  distance_m: number;
  /** 往路は「家を出る時刻」、復路は「家に着く時刻」。'HH:MM'。 */
  time: string;
}

export interface ExpressOption {
  source: 'express_timetable';
  direction: 'outbound' | 'inbound';
  date: string;
  line_id: string;
  line_name: string;
  train_id: string;
  train_name: string;
  board_station: string;
  board_seq: number;
  /** 'HH:MM'。 */
  depart_time: string;
  alight_station: string;
  alight_seq: number;
  arrive_time: string;
  /** 往路: 降車駅 → 拠点 / 復路: 拠点 → 乗車駅。 */
  terminal: ExpressTerminalLeg;
  /** 往路: 出発地点 → 乗車駅 / 復路: 降車駅 → 出発地点。 */
  access: ExpressAccessLeg;
}

export interface ExpressSuggestResult {
  outbound: ExpressOption[];
  inbound: ExpressOption[];
  warnings: string[];
}
