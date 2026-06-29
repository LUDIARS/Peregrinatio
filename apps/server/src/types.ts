// ドメイン型 (spec/data/schema.md と対応)。HTTP API の正となる型。

/** 旅の出発地点の種別。'none'=拠点起点(出発地点なし) / 'home'=自宅 / 'meeting'=拠点以外の集合地点。 */
export type OriginKind = 'none' | 'home' | 'meeting';

export interface Trip {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_path: string | null;
  notes: string | null;
  archived: number; // 0/1 アーカイブ (ゴミ箱)
  // 出発地点 (自宅/集合地点)。初日の往路 + 最終日の復路を自動算出する。座標はスナップショット。
  origin_kind: OriginKind;
  origin_label: string | null;   // 表示名 ('自宅' / 集合地点名)
  origin_address: string | null; // 住所 (集合地点 or 自宅)
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

/** 場所 = 全旅で共有する恒久ライブラリの 1 件。旅には trip_places で紐づく。 */
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
  image_url: string | null; // Web/Places から取得した代表画像
  status: PlaceStatus;       // 'interested'(気になる) | 'visited'(訪問済み) | 'none'
  status_by: string | null;  // 状態を最後に変更した人の表示名 (複数人編集用)
  google_place_id: string | null; // 地図 POI 由来の Google place id (重複防止)
  created_at: string;
  updated_at: string;
}

/** 旅に紐づいた場所 (メンバーシップの is_base / 拠点ホテルの IN・OUT を付与)。 */
export interface TripPlace extends Place {
  is_base: number;               // 0/1 この旅での拠点
  checkin_time: string | null;   // 拠点ホテルのチェックイン時刻 'HH:MM' (自動取得→調整可)
  checkout_time: string | null;  // 拠点ホテルのチェックアウト時刻 'HH:MM'
  postponed: number;             // 0/1 「また今度」(旅ごと。場所リストから隔離)
}

export interface PlaceLink {
  id: string;
  place_id: string;
  url: string;
  title: string | null;
  source: string | null; // 'manual' | 'places' | 'crawl' | 'recommend'
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
  // place でない端点 (出発地点/帰着地点) のラベル。通常区間は null (place 名を引く)。
  from_label: string | null;
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

export interface PlaceSearchResult {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string;
  category?: string | null;
  websiteUri?: string | null;
  photoName?: string | null;
}

// ── 時刻表 / 運行情報 ──────────────────────────────────────────────────────
export type TimetableKind = 'shinkansen' | 'bus' | 'train';

/** 時刻表ボード = 区間 (from→to) の保存単位。 */
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

/** 便 (1 本の列車/バス)。時刻は 'HH:MM'。 */
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

/** 運行情報 (遅延/運休など)。 */
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

/** 取り込みジョブの種別と状態。 */
export type PlaceJobKind = 'image' | 'crawl';
export type PlaceJobStatus = 'pending' | 'processing' | 'done' | 'needs_info' | 'failed';

/** 取り込みジョブ (画像解析/クロールを順次処理するキューの1件)。 */
export interface PlaceJob {
  id: string;
  trip_id: string;
  place_id: string;
  kind: PlaceJobKind;
  status: PlaceJobStatus;
  source_url: string | null;
  is_new_place: number;        // 0/1 取り込みで新規作成した place か (1=成立まで一覧から隠す)
  missing_info: string | null; // 未成立時の不足情報 (ユーザ向け)
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** キュー表示用にジョブへ place 名を添えたもの (GET /api/trips/:id/jobs)。 */
export interface PlaceJobView extends PlaceJob {
  place_name: string | null;
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
