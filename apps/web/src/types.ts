// ドメイン型。apps/server/src/types.ts (= spec/data/schema.md) を正として一致させる。

/** 旅の出発地点の種別。'none'=拠点起点 / 'home'=自宅 / 'meeting'=拠点以外の集合地点。 */
export type OriginKind = 'none' | 'home' | 'meeting';

/** 自宅 (旅をまたいで使い回す出発地点)。住所をジオコーディングして保持。 */
export interface HomeLocation {
  address: string;
  lat: number;
  lng: number;
  station?: string | null;      // 最寄り駅名 (自動取得)
  station_lat?: number | null;
  station_lng?: number | null;
}

export interface Trip {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_path: string | null;
  notes: string | null;
  archived: number; // 0/1 アーカイブ (ゴミ箱)
  // 出発地点 (自宅/集合地点)。初日の往路 + 最終日の復路を自動算出する。
  origin_kind: OriginKind;
  origin_label: string | null;
  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface TripDay {
  id: string;
  trip_id: string;
  day_index: number;
  date: string | null;
  title: string | null;
  notes: string | null;
}

export type PlaceStatus = 'interested' | 'visited' | 'none';

/** 場所 = 全旅で共有する恒久ライブラリの 1 件。 */
export interface Place {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  source_url: string | null;
  summary: string | null;
  notes: string | null;
  image_url: string | null;
  status: PlaceStatus;
  status_by: string | null; // 状態を最後に変更した人の表示名 (複数人編集用)
  google_place_id: string | null; // 地図 POI 由来の Google place id (重複防止)
  created_at: string;
  updated_at: string;
}

/** 旅に紐づいた場所 (is_base / 拠点ホテルの IN・OUT 付き)。TripDetail の places はこれ。 */
export interface TripPlace extends Place {
  is_base: number;
  checkin_time: string | null;  // 拠点ホテルのチェックイン 'HH:MM'
  checkout_time: string | null; // 拠点ホテルのチェックアウト 'HH:MM'
  postponed: number;            // 0/1 「また今度」(旅ごと。場所リストから隔離)
}

export interface PlaceLink {
  id: string;
  place_id: string;
  url: string;
  title: string | null;
  source: string | null;
  created_at: string;
}

export type PlaceImageKind = 'source' | 'composite';

export interface PlaceImage {
  id: string;
  place_id: string;
  kind: PlaceImageKind;
  path: string;
  order_index: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ImageAnalysis {
  id: string;
  place_id: string;
  composite_image_id: string | null;
  analysis_text: string | null;
  extracted_address: string | null;
  extracted_lat: number | null;
  extracted_lng: number | null;
  model: string | null;
  created_at: string;
}

export type ItineraryItemKind = 'visit' | 'move' | 'note';

export interface ItineraryItem {
  id: string;
  day_id: string;
  place_id: string | null;
  order_index: number;
  planned_time: string | null;
  kind: ItineraryItemKind;
  note: string | null;
  edited_by: string | null; // 予定を最後に作成/編集した人の表示名 (複数人編集用)
}

export type RouteMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export interface RouteLeg {
  id: string;
  day_id: string;
  from_place_id: string | null;
  to_place_id: string | null;
  from_label: string | null; // place でない端点 (出発/帰着地点) のラベル
  to_label: string | null;
  mode: RouteMode;
  duration_sec: number | null;
  distance_m: number | null;
  fare_text: string | null;
  polyline: string | null;
  raw_json: string | null;
  note: string | null; // 乗換要約 (Google マップの選択経路 / 暫定)
  depart_time: string | null; // 公共交通の出発時刻 'HH:MM' (選択経路)
  arrive_time: string | null; // 公共交通の到着時刻 'HH:MM' (選択経路)
  computed_at: string;
}

/** 公共交通の経路候補 (Google マップ取得→LLM 解析、ユーザが選ぶ)。 */
export interface TransitOption {
  depart_time: string | null;
  arrive_time: string | null;
  duration_min: number | null;
  fare_yen: number | null;
  interval_min: number | null;
  summary: string;
}

export interface PlaceSearchResult {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string;
  category?: string | null;
}

export interface MapConfig {
  enabled: boolean;
  apiKey: string;
}

// ── 時刻表 / 運行情報 ──────────────────────────────────────────────────────
export type TimetableKind = 'shinkansen' | 'bus' | 'train';

/** 時刻表/運行情報の取得プロバイダ。crawl-llm=URL クロール+LLM / ekispert=駅すぱあと契約。 */
export type TransitProviderKind = 'crawl-llm' | 'ekispert';

export interface Timetable {
  id: string;
  trip_id: string;
  kind: TimetableKind;
  line_name: string | null;
  from_station: string | null;
  to_station: string | null;
  notes: string | null;
  created_at: string;
}

export interface TimetableDeparture {
  id: string;
  timetable_id: string;
  depart_time: string | null;
  arrive_time: string | null;
  train_name: string | null;
  platform: string | null;
  fare_text: string | null;
  note: string | null;
  order_index: number;
  created_at: string;
}

export interface ServiceAlert {
  id: string;
  trip_id: string;
  line_name: string | null;
  severity: string;
  title: string | null;
  body: string | null;
  source_url: string | null;
  fetched_at: string | null;
  created_at: string;
}

/** 取り込みジョブ (画像解析/クロールの順次処理キュー)。 */
export type PlaceJobKind = 'image' | 'crawl';
export type PlaceJobStatus = 'pending' | 'processing' | 'done' | 'needs_info' | 'failed';

export interface PlaceJob {
  id: string;
  trip_id: string;
  place_id: string;
  kind: PlaceJobKind;
  status: PlaceJobStatus;
  source_url: string | null;
  is_new_place: number;
  missing_info: string | null; // 未成立時の不足情報 (ユーザ向け)
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** キュー表示用にジョブへ place 名を添えたもの。 */
export interface PlaceJobView extends PlaceJob {
  place_name: string | null;
}

/** 新幹線/飛行機の予約サジェスト 1 件。 */
export interface ReservationSuggestion {
  mode: 'shinkansen' | 'flight';
  title: string;
  operator: string;
  from: string;
  to: string;
  url: string;
  note?: string;
  distance_km: number;
  destination: string; // どの目的地に対するサジェストか
}

export interface ReservationSuggestionsResult {
  origin: string | null;
  suggestions: ReservationSuggestion[];
}

export interface TripDetail {
  trip: Trip;
  days: TripDay[];
  places: TripPlace[];
}

/** 取り込んだ GTFS フィード (バス/一部鉄道の時刻表)。 */
export interface GtfsFeed {
  id: string;
  name: string;
  source_url: string | null;
  imported_at: string;
  stop_count: number;
  trip_count: number;
}

/** 近くの GTFS 停留所 (距離付き)。 */
export interface GtfsStopHit {
  feed_id: string;
  feed_name: string;
  stop_id: string;
  stop_name: string | null;
  lat: number | null;
  lng: number | null;
  distance_m: number;
}

/** GTFS 停留所の発車便。 */
export interface GtfsDeparture {
  departure_time: string | null;
  route_name: string | null;
  headsign: string | null;
  route_type: number | null;
}

/** GTFS 路線 (選択用、便数つき)。 */
export interface GtfsRoute {
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  route_type: number | null;
  trip_count: number;
}

export interface GtfsTimetableStop { stop_id: string; stop_name: string | null; lat: number | null; lng: number | null; }
export interface GtfsTimetableTrip { trip_id: string; headsign: string | null; service_id: string | null; times: (string | null)[]; }
/** 同じ停車順序でまとめた時刻表 (stops=横軸、trips=縦軸を時刻順)。 */
export interface GtfsTimetablePattern {
  direction_id: number | null;
  headsign: string | null;
  stops: GtfsTimetableStop[];
  trips: GtfsTimetableTrip[];
}

export interface GtfsRouteTimetable {
  date: string; // 絞り込んだ運行日 YYYYMMDD
  patterns: GtfsTimetablePattern[];
}
