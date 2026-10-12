# HTTP API 契約 (spec/interface)

ベース: `http://127.0.0.1:8091/api` (server config.port = 8091)。
すべて JSON (画像アップロードのみ multipart/form-data)。エラーは `{ error: string }` + 4xx/5xx。
認証は単独利用では dev 固定ユーザ。将来 Cernere 連携 (Authorization: Bearer <PASETO>)。

## 全エンドポイント共通: Cloudflare Access 検証
runtime-config (`EXCUBITOR_SERVICE_CONFIG_JSON.cloudflareAccess.{teamDomain,audience}`) があるとき、
ループバック以外から来た要求 (公開入口の Tunnel 経由) は `Cf-Access-Jwt-Assertion` を検証する。
`/api/*`・静的配信・共有リンク `/s/:token`・`/healthz` すべてが対象 (例外パスなし)。
失敗は `403` + `{ error: <理由コード> }`:
`missing_assertion` / `malformed_token` / `unsupported_alg` / `unknown_kid` / `bad_signature` /
`bad_issuer` / `bad_audience` / `expired` / `not_yet_valid`。
ループバック = 送信元ソケットがループバック かつ Host がループバック名 かつ `cf-connecting-ip` / `cf-ray` /
`cf-access-jwt-assertion` が無い要求。参照: [`../feature/cf-access.md`](../feature/cf-access.md)

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
- `GET /api/trips/:id/places` → `Array<TripPlace & { access_marks?: AccessMarks }>`
  - 拠点以外・座標のある場所にアクセス印を付ける (下の「アクセス印」)。
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
- `GET /api/places/search?q=&lat=&lng=&radius=&trip_id=` → `PlaceSearchResult[]`
  - Google Places (Nearby/Text) 検索。結果は未保存候補 (name/address/lat/lng/place_id)。
  - `trip_id` を渡すと、その旅の拠点を起点にしたアクセス印 `access_marks` を各候補に付ける (シャトルは付けない)。
    - `POST /api/places/:id/crawl` の LLM 抽出に `shuttle_bus` (有無・根拠文) が加わり、以後のシャトル判定はそれを優先する。

## アクセス印 (🚕 初乗り圏 / 🚏 バス停近い / 🚌 シャトルあり)
参照: [`../feature/nearby-access-marks.md`](../feature/nearby-access-marks.md)

`AccessMarks = { taxi_first_fare?, bus_stop_near?, shuttle_bus?, unchecked? }`。付かない印はキーごと省く
(否定の印は出さない)。Places の失敗で調べきれなかった印は `unchecked` に理由を入れる。
- `taxi_first_fare`: `{ origin_kind: 'base'|'station', origin_name, distance_m, threshold_m }`
- `bus_stop_near`: `{ stop_name, distance_m, source: 'gtfs'|'places', radius_m }`
- `shuttle_bus`: `{ evidence, source: 'crawl'|'summary'|'notes'|'facility', source_url }`

- `GET /api/trips/:id/access-marks` → `{ [place_id]: AccessMarks }` (拠点以外の旅の場所。画面の一覧・詳細が使う)
- `GET /api/settings/access-marks` → `{ taxi_first_fare_m, is_default, default_taxi_first_fare_m, min, max }`
- `PUT /api/settings/access-marks` `{ taxi_first_fare_m: 300〜10000 の整数 }` → `{ taxi_first_fare_m, is_default }` (範囲外は 400)
- `DELETE /api/settings/access-marks` → 既定 (1200m) に戻す

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
- `PUT /api/legs/:id/fixed`
  `{ mode, transit_kind?, depart_time?, arrive_time?, note?, is_fixed }` → `RouteLeg`
  - 1 区間の確定情報だけを更新し、`route_segment_modes` にも保存する。
  - `transit_kind` は `mode='transit'` のときだけ指定でき、
    `shinkansen | train | bus | airplane | taxi` のいずれか。
  - 時刻は `HH:MM`、メモは最大 4000 文字。`http/https` URL をプレーンテキストで保存する。

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
  `{ primary_mode?, day_start?, day_end?, pace?, must_place_ids?, exclude_place_ids?, use_routes_api?,
     max_station_hops?, reach_radius_m?, use_llm? }`
  → `PlanSuggestResult`
  - 交通手段を軸に日割り案を作る。`days[].items[]` の move には `mode` / `duration_sec` /
    `duration_source` ('routes'=実所要 | 'estimate'=概算) が入る。
  - 候補は拠点の最寄り駅から `max_station_hops` 駅ぶん (既定 3) の範囲だけ。実際に使った範囲は
    `reach` (`radius_m` / `source` / `stations[]`) で返す。`reach_radius_m` を渡すと駅探索をせず
    その半径を使う。
  - 載せきれなかった場所と範囲外の場所は `leftovers[]` に理由付きで落ちる。
  - `strategy` が `'transit_timetable'` なら時刻表の実便で組んだ案 (move に `transit` と
    `duration_source='gtfs'` が入る)、`'estimate'` なら距離からの概算。
  - `new_places[]` は沿線で見つけた、旅にまだ無い候補 (places には保存していない)。各候補に `access_marks`。
  - 出発地点と拠点があれば、新幹線・特急の時刻表ライブラリから往路・復路の便を引き、初日・最終日の
    「別手配」メモ行を便の行 (`duration_source='express_timetable'`、出発地点→乗車駅 / 列車 / 降車駅→拠点)
    に差し替える。往復便の行には `express_ref: { direction, option_index }` が付き、候補は
    `express: { outbound: { option, items }[], inbound: [...], selected_outbound, selected_inbound } | null`
    で返す (画面で別の候補の `items` に差し替えられる)。便が無いときは従来のメモ行のまま理由を `warnings` に出す。
- `POST /api/trips/:id/plan/adopt` `{ days: PlanDay[], confirm: true }`
  → `{ days: TripDay[], items: number, replaced: number }`
  - **上書き**。案に含まれる日の `itinerary_items` と `route_legs` を消してから入れ直す。
    `confirm` が無ければ 400。他の旅の place_id はメモ行に落として黙って捨てない。
  - 全 `days` を更新前に検証し、置換は単一トランザクションで反映する。不正なら 400 で既存予定を変更しない。

## 新幹線・特急の時刻表ライブラリ
旅をまたいで共有する (旅を消しても残る)。取り込みは **プレビュー → 保存** の 2 段。
参照: [`../feature/express-timetables.md`](../feature/express-timetables.md)

- `GET /api/express/lines` → `ExpressLineSummary[]` (路線 + `station_count` / `train_count`)
- `GET /api/express/lines/:id` → `ExpressLineDetail` (`stations[]` は下り方向の seq 順、`trains[].stops[]` は進行順)
- `DELETE /api/express/lines/:id` → `{ ok: true }` (旅の区間ボードへ写した便は残る)
- `PATCH /api/express/lines/:id/stations/:seq` `{ lat, lng }` (消すときは両方 null) → `ExpressStation`
- `POST /api/express/import/preview` → `ExpressImportPayload` (`{ line, stations, trains, warnings }`、保存しない)
  - 貼り付け: `{ mode: 'paste', line: { name, kind, operator?, valid_from?, source_url? }, tables: [{ direction: 'down'|'up', text }] }`
    (TSV/CSV。1 行目 = 列車名、以降 = 駅名, 時刻…。通過 `↓` `レ` `||`、非経由は空欄、着発併記可)
  - URL: `{ mode: 'url', line, url, direction? }` (HTML は crawl → LLM、PDF は Read ツールで LLM 抽出)。
    取得・抽出失敗は 502、URL / 路線名不足は 400 (どちらも貼り付けへ誘導する文言)。
  - 駅順と時刻の単調増加を検証し、崩れた列車は落として `warnings` に出す。駅座標は「駅名 + 駅」で Geocoding
    (失敗・キー未設定は null + `warnings`)。
- `POST /api/express/import` (preview と同じ形 + `replace_line_id?`) → `{ line: ExpressLineDetail, warnings }`
  - 単一トランザクションで保存。保存できる列車が無い・路線名/種別/駅が不正なら 400。
- `GET /api/express/lines/:id/segments?from_seq=&to_seq=&date=&after=` → `ExpressSegment[]`
  - 乗車駅→降車駅で乗れる便 (運行日で絞り、`after` 以降)。しおりの「移動を追加」が使う。
- `POST /api/trips/:id/express/suggest` `{ inbound_leave_time?: 'HH:MM' }` → `{ outbound: ExpressOption[], inbound: ExpressOption[], warnings }`
  - DB は変えない。乗車駅 = 出発地点に最も近い駅 (50km 以内)、降車駅 = 同じ路線で拠点に最も近い駅。
  - 往路: 降車駅着 + 端末交通 (GTFS バス、無ければタクシー概算) がチェックイン (既定 15:00) までに
    収まる便を遅い順に 3 本 + 最も早い便。復路: チェックアウト (既定 10:00、または `inbound_leave_time`)
    に拠点を出て駅に着いた後の便を早い順に 3 本。`weekday`/`holiday` は曜日で判定し、祝日・
    `valid_from` が 1 年以上前のときは `warnings`。
- `POST /api/trips/:id/express/adopt` `{ train_id, from_seq, to_seq }` → `{ timetable: Timetable, departure: TimetableDeparture }`
  - 便を旅の区間ボード (timetables / timetable_departures) に写す。同じ便は 1 行にまとめる。進行方向と逆なら 400。
- 旧 `POST /api/trips/:id/timetables/tohoku-shinkansen-seed` / `tohoku-shinkansen-bus-suggestions` は削除
  (「なすの」は seed 路線 `seed-tohoku-shinkansen` としてライブラリに移した)。

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
