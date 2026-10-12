# 周辺候補のアクセス印 (タクシー初乗り圏・バス停近い・シャトルバスあり)

## 目的

目的地周辺の候補を眺めたときに「車が無くても行けるか」を一目で分かるようにする。
候補ごとに次の 3 つの印を付ける。

| 印 | 表示 | 意味 |
|---|---|---|
| `taxi_first_fare` | 🚕 初乗り圏 | 拠点 (宿) または最寄り駅から、タクシーの初乗り距離で着く |
| `bus_stop_near` | 🚏 バス停 ○m | 候補から徒歩圏 (既定 300m) にバス停がある |
| `shuttle_bus` | 🚌 シャトルあり | 施設が送迎バス / シャトルバスを出している |

## 印を付ける場所

1. 旅の場所一覧 (左カラム / モバイルのドロワー) と場所の詳細
2. 拠点周辺のおすすめ自動収集で追加された場所 (1 に含まれる)
3. プラン提案の `new_places` (旅に未追加の候補)
4. 地図の「場所を検索」の結果 (`GET /api/places/search` に `trip_id` を渡したとき)

## 判定

すべてサーバの `apps/server/src/access-marks/` (ドメイン) で計算し、API が各候補に
`access_marks: { taxi_first_fare?, bus_stop_near?, shuttle_bus? }` を付けて返す。
付かない印はキーごと省く (「無い」と「調べていない」を区別するため、否定の印は出さない)。

### タクシー初乗り圏

- 起点は **拠点** と **最寄り駅** の 2 つ。どちらかから収まれば印を付け、起点名を添える (「拠点から 0.9km」「那須塩原駅から 1.1km」)。
- 最寄り駅は、取り込み済みの新幹線・特急の駅 → 鉄道 GTFS の駅 (route_type 0/1/2) → Places の鉄道駅 の順で、候補から 3km 以内で最も近いもの。
- 道のり = 直線距離 × 車の迂回係数 (`plan-travel` の `DRIVING_DETOUR` を共有する。値を複製しない。現在 1.35)。
- 初乗り距離は設定 (`app_settings` の `taxi_first_fare_m`、既定 1,200m) で、設定ページから変えられる。
  地域ごとの運賃表は持たない (正確な表を保守できないため)。印には使った閾値を添える。

### バス停近い

- GTFS の停留所 (`nearbyStops`、バス = route_type 3 を含むフィード) で候補から 300m 以内を探す。
- GTFS で見つからず Places のキーがあるときだけ、Places Nearby Search (`bus_stop` / `bus_station`) で探す。
  結果は場所ごとに `place_access_cache` へ保存し (7 日で再取得)、同じ場所で何度も API を呼ばない。
  `new_places` と検索結果は保存されていないので google_place_id をキーにキャッシュする。
- 印には停留所名と距離、出典 (`gtfs` / `places`) を入れる。

### シャトルバスあり

- 場所の要約・メモ・設備候補 (`place_facilities`)・資料リンクのクロール結果の本文から
  「送迎 / シャトル / 無料バス / 送迎バス / 巡回バス」を探す。見つかれば根拠の抜粋 (前後 40 文字) と出典を付ける。
- 施設サマリーのクロール→LLM 処理 (既存) の抽出項目に `shuttle_bus` (有無・根拠文) を足し、以後はそれを優先する。
- 本文が無い候補 (`new_places`・検索結果) には付けない。

## 画面

一覧の行と詳細に小さなチップで並べる (🚕 / 🚏 / 🚌)。チップを押すと根拠 (起点と距離、停留所名、抜粋) を出す。
設定ページに「タクシー初乗り距離」を足す。

## データ (新規 migration)

- `place_access_cache` (key: place_id または google_place_id、kind、value_json、fetched_at)
- `app_settings` に `taxi_first_fare_m` (既存の key/value テーブル)

## 範囲外

- 運賃の計算、バスの便の有無 (それは時刻表・プラン提案の役目)、シャトルの時刻。

## 実装メモ (2026-10-13)

- 置き場所: `apps/server/src/access-marks/` (タクシー / シャトル / 判定の順序 / 問い合わせ / キャッシュ / 設定 / 応答への付与)、
  `routes/access-marks.ts`、migration `023_place_access_cache.sql`。
- 旅の場所一覧 `GET /api/trips/:id/places` に `access_marks` を付けるほか、画面の一覧・詳細は旅詳細 (`GET /api/trips/:id`) を
  待たせないよう `GET /api/trips/:id/access-marks` (`{ [place_id]: AccessMarks }`) を別に読む。拠点そのものには付けない。
- Places の問い合わせに失敗したときは印を付けず、`unchecked` に「調べきれていない」理由を入れる (「無い」と読ませない)。
- 未保存の候補のキャッシュキーは `google:<google_place_id>` (旅の場所の place_id と衝突させない)。
  「見つからなかった」結果も保存して 7 日は再問い合わせしない。
- 最寄り駅の Places 検索は Nearby Search (`train_station` / `subway_station` / `light_rail_station`、3km の円内)、
  バス停は `bus_stop` / `bus_station` (300m の円内)。どちらも GTFS で見つかれば Places を呼ばない。
- クロール本文は保存していないため、「資料リンクのクロール結果」は施設サマリーのクロール→LLM 抽出時に `shuttle_bus`
  (有無・根拠文) として `place_access_cache(kind='shuttle_llm')` に残す形で扱う。LLM が「無い」と判断した場所は
  要約やメモに語があっても印を付けない (LLM の判断を優先)。キーワード検索は「送迎なし」のような否定の直後表現を除外する。
- 初乗り距離は 300〜10,000m の整数。設定 API は `GET/PUT/DELETE /api/settings/access-marks`。

## 条項

- `SPEC-ACCESS-TAXI`: 拠点または最寄り駅 (新幹線・特急の駅 → 鉄道 GTFS → Places、3km 以内) から、道のり (直線 × 車の迂回係数) が初乗り距離以内なら 🚕 を付け、起点と距離と閾値を添える。
- `SPEC-ACCESS-BUS`: GTFS のバス停 (300m 以内) を先に探し、無く Places キーがあるときだけ Places で探して 7 日キャッシュする。🚏 に停留所名・距離・出典を添える。
- `SPEC-ACCESS-SHUTTLE`: 施設サマリーのクロール→LLM が抽出したシャトルの有無を優先し、無ければ要約・メモ・設備の送迎系の語から根拠の抜粋 (前後 40 文字) を付ける。本文の無い候補には付けない。
- `SPEC-ACCESS-ATTACH`: 旅の場所一覧・詳細・プランの new_places・場所検索 (trip_id 付き) の各候補に access_marks を付け、付かない印はキーごと省く (否定の印を出さない)。
- `SPEC-ACCESS-SETTINGS`: タクシー初乗り距離は app_settings の taxi_first_fare_m (既定 1,200m) で、設定ページから変えられる。
- `SPEC-ACCESS-UI`: 一覧の行と詳細に 🚕 / 🚏 / 🚌 のチップを並べ、押すと根拠を出す。

## ファイルと役割

| ファイル | 役割 | 条項 |
|---|---|---|
| `apps/server/src/access-marks/types.ts` | 印と候補の型 | SPEC-ACCESS-ATTACH |
| `apps/server/src/access-marks/taxi.ts` | 🚕 初乗り圏の判定 | SPEC-ACCESS-TAXI |
| `apps/server/src/suggest/plan-travel.ts` | 車の迂回係数 `DRIVING_DETOUR` を公開 (値を複製しない) | SPEC-ACCESS-TAXI |
| `apps/server/src/access-marks/shuttle.ts` | 🚌 シャトルの判定 (LLM 抽出優先・キーワード・否定除外) | SPEC-ACCESS-SHUTTLE |
| `apps/server/src/access-marks/shuttle-store.ts` | クロール→LLM のシャトル判断を保存 | SPEC-ACCESS-SHUTTLE |
| `apps/server/src/routes/crawl.ts` / `packages/crawl/src/extract.ts` | 施設サマリー抽出に `shuttle_bus` を足す | SPEC-ACCESS-SHUTTLE |
| `apps/server/src/access-marks/judge.ts` | 候補 1 件の判定と問い合わせの順序 (GTFS → Places) | SPEC-ACCESS-TAXI / BUS / SHUTTLE |
| `apps/server/src/access-marks/lookups.ts` | 問い合わせの本番実装 (時刻表の駅・GTFS・Places) | SPEC-ACCESS-TAXI / BUS |
| `apps/server/src/access-marks/cache.ts` | `place_access_cache` (7 日) | SPEC-ACCESS-BUS |
| `apps/server/src/lib/gtfs-query.ts` | route_type で絞った近傍停留所 (`nearbyStopsServing`) | SPEC-ACCESS-BUS |
| `packages/places/src/index.ts` | Places Nearby Search (`searchNearbyByTypes`) | SPEC-ACCESS-BUS |
| `apps/server/src/access-marks/settings.ts` | タクシー初乗り距離 | SPEC-ACCESS-SETTINGS |
| `apps/server/src/access-marks/attach.ts` / `candidates.ts` | 応答の行に印を付ける入口 | SPEC-ACCESS-ATTACH |
| `apps/server/src/routes/access-marks.ts` | 印の一覧・設定の HTTP API | SPEC-ACCESS-ATTACH / SETTINGS |
| `apps/server/src/routes/places.ts` / `search.ts` / `suggest.ts` | 場所一覧・検索・プランの new_places に付与 | SPEC-ACCESS-ATTACH |
| `apps/web/src/components/place/AccessMarkChips.tsx` | 🚕 / 🚏 / 🚌 のチップと根拠 | SPEC-ACCESS-UI |
| `apps/web/src/components/place/useTripAccessMarks.ts` | 旅の場所の印を読む (旅詳細を待たせない) | SPEC-ACCESS-UI |
| `apps/web/src/pages/TripDetail.tsx` / `PlaceDetail.tsx` / `apps/web/src/components/MapSearchOverlay.tsx` | 一覧・詳細・検索結果に並べる | SPEC-ACCESS-UI |
| `apps/web/src/components/place/AccessMarkSettingsCard.tsx` / `apps/web/src/pages/Settings.tsx` | 設定ページの「タクシー初乗り距離」 | SPEC-ACCESS-SETTINGS |
