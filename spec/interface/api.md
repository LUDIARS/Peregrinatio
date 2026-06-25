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
- `GET /api/trips/:id/pdf` → application/pdf (しおり PDF。Puppeteer レンダリング)

## days
- `GET /api/trips/:id/days` → `TripDay[]`
- `POST /api/trips/:id/days` `{ date?, title?, notes? }` → `TripDay` (day_index 自動採番)
- `PATCH /api/days/:id` `{ date?, title?, notes? }` → `TripDay`
- `DELETE /api/days/:id` → `{ ok: true }`

## places (= ピン)
- `GET /api/trips/:id/places` → `Place[]`
- `POST /api/trips/:id/places` `{ name, address?, lat?, lng?, category?, source_url?, notes? }` → `Place`
- `PATCH /api/places/:id` `{ ...部分 }` → `Place`
- `DELETE /api/places/:id` → `{ ok: true }`
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
- `PATCH /api/items/:id` `{ ...部分, order_index? }` → `ItineraryItem`
- `DELETE /api/items/:id` → `{ ok: true }`

## routing
- `POST /api/days/:id/route` `{ mode?: 'driving'|'walking'|'transit'|'bicycling' }` → `RouteLeg[]`
  - その日の itinerary_items の place 列を順に Google Routes API へ。route_legs を再計算して返す。
- `GET /api/days/:id/route` → `RouteLeg[]`

## 型 (TypeScript、apps/server/src/types.ts を正とする)
Trip/TripDay/Place/PlaceImage/ImageAnalysis/ItineraryItem/RouteLeg は spec/data/schema.md のカラムに対応。
PlaceSearchResult = `{ name, address, lat, lng, place_id, category? }`。
