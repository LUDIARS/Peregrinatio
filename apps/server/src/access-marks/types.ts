// 周辺候補のアクセス印。付かない印はキーごと省く (否定の印は出さない:
// 「無い」と「調べていない」を区別できないため)。
// @implements SPEC-ACCESS-ATTACH

export interface TaxiFirstFareMark {
  /** 起点の種類 (拠点 / 最寄り駅)。 */
  origin_kind: 'base' | 'station';
  origin_name: string;
  /** 道のり (直線 × 車の迂回係数) の m。 */
  distance_m: number;
  /** 判定に使った初乗り距離 (m)。 */
  threshold_m: number;
}

export interface BusStopNearMark {
  stop_name: string;
  distance_m: number;
  source: 'gtfs' | 'places';
  /** 判定に使った徒歩圏 (m)。 */
  radius_m: number;
}

export interface ShuttleBusMark {
  /** 根拠の抜粋 (前後 40 文字)。 */
  evidence: string;
  /** どこから見つけたか ('crawl' = 施設サマリーのクロール→LLM / summary / notes / facility)。 */
  source: 'crawl' | 'summary' | 'notes' | 'facility';
  source_url: string | null;
}

export interface AccessMarks {
  taxi_first_fare?: TaxiFirstFareMark;
  bus_stop_near?: BusStopNearMark;
  shuttle_bus?: ShuttleBusMark;
  /**
   * 外部問い合わせ (Places) に失敗して調べきれなかった印と理由。印が無いことを「無い」と
   * 読ませないために出す。全部調べられたときはキーごと省く。
   */
  unchecked?: Partial<Record<'taxi_first_fare' | 'bus_stop_near', string>>;
}

/** 印を付ける候補 1 件。 */
export interface AccessCandidate {
  /** 外部問い合わせのキャッシュキー (place_id または google_place_id)。 */
  cache_key: string;
  lat: number;
  lng: number;
  /** 保存済みの場所なら本文 (要約・メモ・設備) を持つ。未保存の候補は持たない (シャトル判定をしない)。 */
  texts: CandidateTexts | null;
}

export interface CandidateTexts {
  place_id: string;
  summary: string | null;
  notes: string | null;
  facilities: string[];
}
