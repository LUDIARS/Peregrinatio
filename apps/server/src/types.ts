// ドメイン型 (spec/data/schema.md と対応)。HTTP API の正となる型。

export interface Trip {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_image_path: string | null;
  notes: string | null;
  archived: number; // 0/1 アーカイブ (ゴミ箱)
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
  created_at: string;
  updated_at: string;
}

/** 旅に紐づいた場所 (メンバーシップの is_base を付与)。 */
export interface TripPlace extends Place {
  is_base: number; // 0/1 この旅での拠点
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
}

export type RouteMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export interface RouteLeg {
  id: string;
  day_id: string;
  from_place_id: string | null;
  to_place_id: string | null;
  mode: RouteMode;
  duration_sec: number | null;
  distance_m: number | null;
  fare_text: string | null;
  polyline: string | null;
  raw_json: string | null;
  computed_at: string;
}

export interface PlaceSearchResult {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string;
  category?: string | null;
}
