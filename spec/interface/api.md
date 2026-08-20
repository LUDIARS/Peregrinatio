# HTTP API 契約 (spec/interface)

ベース: `http://127.0.0.1:8090/api` (server config.port = 8090)。
すべて JSON (画像アップロードのみ multipart/form-data)。エラーは `{ error: string }` + 4xx/5xx。
認証は単独利用では dev 固定ユーザ。将来 Cernere 連携 (Authorization: Bearer <PASETO>)。

## 設定 / 地図
- `GET /api/map-config` → `{ enabled: boolean, apiKey: string }`
  - Google Maps JS API key (referrer 制限前提) と有効フラグ。key 空なら enabled=false。

## trips
- `GET /api/trips` → `Trip[]`
- `POST /api/trips` `{ title, start_date?, end_date?, notes? }` → `Trip`
- `GET /api/trips/:id` → `{ trip: Trip, days: TripDay[], places: Place[] }`
- `PATCH /api/trips/:id` `{ title?, start_date?, end_date?, notes?, cover_image_path? }` → `Trip`
- `DELETE /api/trips/:id` → `{ ok: true }`
- `GET /api/trips/:id/share` → `{ token, password_protected } | null`
- `PUT /api/trips/:id/share` `{ password: string | null }` → `{ token, password_protected }`
- `GET /api/shares/:token` → 合言葉なしなら旅の最小概要、合言葉ありなら `{ password_protected: true }`
- `POST /api/shares/:token/unlock` `{ password }` → `{ trip: SharedTripSummary }`
  - 合言葉は scrypt ハッシュで保存し、照合前には旅ID・タイトルを返さない。
- `GET /api/trips/:id/pdf` → application/pdf (しおり PDF。Puppeteer レンダリング)

## days
- `GET /api/trips/:id/days` → `TripDay[]`
- `POST /api/trips/:id/days` `{ date?, title?, notes? }` → `TripDay` (day_index 自動採番)
- `PATCH /api/days/:id` `{ date?, title?, notes? }` → `TripDay`
- `DELETE /api/days/:id` → `{ ok: true }`

## places (= ピン)
- `GET /api/trips/:id/places` → `TripPlace[]`
- `POST /api/trips/:id/places` `{ name, address?, lat?, lng?, category?, source_url?, notes? }` → `Place`
- `PATCH /api/places/:id` `{ ...部分 }` → `Place`
- `DELETE /api/places/:id` → `{ ok: true }`
- `PATCH /api/trips/:id/places/:placeId` `{ is_base?, base_name?, checkin_time?, checkout_time?, postponed? }` → `TripPlace`
  - `base_name` は Unicode 文字単位で8文字以内。拠点設定時に未設定なら正式名から初期値を作る。
- `GET /api/trips/:id/places/:placeId/facilities` → `PlaceFacility[]`
- `POST /api/trips/:id/places/:placeId/facilities/suggest` → `{ place: TripPlace, facilities: PlaceFacility[] }`
  - Haiku が8文字以内の拠点名と、拠点・複合施設内の設備候補を提案する。
- `PATCH /api/trips/:id/places/:placeId/facilities/:facilityId` `{ wanted: boolean }` → `PlaceFacility`
  - やりたいチェックは旅行単位で保存する。
- `POST /api/places/:id/crawl` `{ url? }` → `Place`
  - source_url か name から候補URLを得て取得→本文抽出→LLM 要約。summary/category/address を更新。
    address が取れたら Geocoding して lat/lng をセット。
- `GET /api/places/search?q=&lat=&lng=&radius=` → `PlaceSearchResult[]`
  - Google Places (Nearby/Text) 検索。結果は未保存候補 (name/address/lat/lng/place_id)。

## place images
- `POST /api/places/:id/images` (multipart: field `files`、複数可) → `PlaceImage[]`
  - 連番画像を複数アップロード (kind='source', order_index= 受信順)。
- `GET /api/places/:id/images` → `PlaceImage[]`
- `POST /api/places/:id/images/compose` `{ order?: 'rtl'|'ltr' }` → `PlaceImage` (composite)
  - source 画像を **既定 rtl=右→左** に横連結して composite を 1 枚保存。
- `POST /api/images/:id/analyze` → `ImageAnalysis`
  - composite を LLM(vision) に渡し analysis_text を生成。住所判明なら extracted_* + Geocoding で
    place の lat/lng/address を補完しピンを立てる。
- 静的配信: `GET /uploads/*` (アップロード/合成画像の取得)

## itinerary
- `GET /api/days/:id/items` → `ItineraryItem[]`
- `POST /api/days/:id/items` `{ place_id?, planned_time?, kind, note? }` → `ItineraryItem`
- `PATCH /api/items/:id` `{ ...部分, day_id?, order_index? }` → `ItineraryItem` (day_id 指定で別日へ移動)
- `DELETE /api/items/:id` → `{ ok: true }`

## routing
- `POST /api/days/:id/route` `{ mode?: 'driving'|'walking'|'transit'|'bicycling' }` → `RouteLeg[]`
  - その日の itinerary_items の place 列を順に Google Routes API へ。route_legs を再計算して返す。
- `GET /api/days/:id/route` → `RouteLeg[]`

## 提案 (荷物 / 季節 / プラン)
`/suggest` と `/season-hints` は **DB を変えない** (プレビュー)。書き込むのは `/adopt` だけ。
参照: [`../feature/trip-suggestions.md`](../feature/trip-suggestions.md)

- `POST /api/trips/:id/packing/suggest` `{ use_llm?: boolean }` → `PackingSuggestResult`
  - 拠点の設備・行き先・季節から持ち物を提案する。`suggestions[]` (追加候補)、`drops[]` (現地にあるので
    持参不要)、`hints[]` (季節の見どころ)、`warnings[]` (LLM 失敗等で縮退した理由)。
  - `use_llm=false` でルール由来のみ (LLM を呼ばない)。
- `POST /api/trips/:id/packing/adopt` `{ items: [{ title, quantity?, category?, reason? }], remove_item_ids?: string[] }`
  → `{ created: TripCheckItem[], skipped: number, removed: number }`
  - 選ばれた分だけを `trip_check_items(list_type='packing')` に入れる。同名は `skipped`。
  - `remove_item_ids` は「持参不要」で明示的に外す既存行。
  - 全入力を更新前に検証し、追加と削除は単一トランザクションで反映する。不正なら 400 で変更しない。
- `GET /api/trips/:id/season-hints` → `{ season_label: string | null, hints: SeasonalHint[] }`
- `POST /api/trips/:id/plan/suggest`
  `{ primary_mode?, day_start?, day_end?, pace?, must_place_ids?, exclude_place_ids?, use_routes_api?, use_llm? }`
  → `PlanSuggestResult`
  - 交通手段を軸に日割り案を作る。`days[].items[]` の move には `mode` / `duration_sec` /
    `duration_source` ('routes'=実所要 | 'estimate'=概算) が入る。
  - 載せきれなかった場所は `leftovers[]` に理由付きで落ちる。
- `POST /api/trips/:id/plan/adopt` `{ days: PlanDay[], confirm: true }`
  → `{ days: TripDay[], items: number, replaced: number }`
  - **上書き**。案に含まれる日の `itinerary_items` と `route_legs` を消してから入れ直す。
    `confirm` が無ければ 400。他の旅の place_id はメモ行に落として黙って捨てない。
  - 全 `days` を更新前に検証し、置換は単一トランザクションで反映する。不正なら 400 で既存予定を変更しない。

## 静的配信 (`/api` 配下ではない)
- `GET /build-meta.json` → `{ version: string, built_at: string | null }`
  - 現在配信中の web ビルドの識別子。`Cache-Control: no-store`。
  - 未ビルド/読み取り失敗時は `503` + `{ version: 'unknown', built_at: null }`。
  - 参照: [`../feature/build-freshness.md`](../feature/build-freshness.md)
- `GET /` および SPA フォールバックの `index.html` も `Cache-Control: no-store` で返す。

## 型 (TypeScript、apps/server/src/types.ts を正とする)
Trip/TripDay/Place/PlaceImage/ImageAnalysis/ItineraryItem/RouteLeg は spec/data/schema.md のカラムに対応。
PlaceSearchResult = `{ name, address, lat, lng, place_id, category? }`。
提案の型 (PackingSuggestResult / PlanSuggestResult / SeasonalHint 等) は `apps/server/src/suggest/types.ts` を正とする。
