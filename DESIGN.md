# Peregrinatio 設計メモ (plan 相当の作業ドキュメント)

恒久情報は `spec/` 各分類へ切り出す。本書は設計判断の経緯と全体像をまとめる作業ノート。

## 1. ねらい

旅行前〜旅行中に、(1) 行きたい場所を地図ベースで集め、(2) Web/画像から情報をサマって、
(3) 日付ごとの行動予定(経路つき)に組み、(4) PDF しおりにして印刷/共有する。
操作の主戦場は iOS Safari なので **PWA** とし、写真ライブラリからの画像取り込みを前提にする。

下敷き: Tirocinium (Tr) の Map ビュー(`CompanyMap.tsx`)とサマリー処理
(`crawler.ts`/`extract.ts`/PoliteFetcher、LLM コンプリータ)を流用する。

## 2. アーキテクチャ

- monorepo (npm workspaces)。Tr と同型: `apps/server` (Hono) + `apps/web` (React/Vite) + `packages/*`。
- DB は `databaseUrl` 空で **SQLite 既定** (単独利用前提)、共有時のみ Postgres に切替 (Tr 踏襲)。
- LLM は **LUDIARS 規約に従い `claude` CLI (claude -p)** をデフォルト backend にする
  (API 不使用)。vision はファイルを CLI に渡して解析する。`llmBackend: 'cli' | 'api'`。
- Google Maps: JS API key はブラウザに渡る (HTTP referrer 制限前提)。Geocoding/Places/Routes に同 key。
  `/map-config` で enabled フラグと key をフロントへ返す (Tr 踏襲)。

## 3. データモデル

| テーブル | 役割 | 主なカラム |
|---|---|---|
| `trips` | 旅(=しおり1冊) | id, title, start_date, end_date, cover_image_path, notes, created_at, updated_at |
| `trip_days` | 旅の各日 | id, trip_id, day_index, date, title, notes |
| `places` | 気になる場所/施設(=地図ピン) | id, trip_id, name, address, lat, lng, category, source_url, summary, notes, pinned, created_at, updated_at |
| `place_images` | 場所に紐づく画像 | id, place_id, kind('source'|'composite'), path, order_index, width, height, created_at |
| `image_analyses` | 「画像を解析」結果 | id, place_id, composite_image_id, analysis_text, extracted_address, extracted_lat, extracted_lng, model, created_at |
| `itinerary_items` | 日ごとの行動予定 | id, day_id, place_id(null可), order_index, planned_time, kind('visit'|'move'|'note'), note |
| `route_legs` | 予定間の経路 | id, day_id, from_place_id, to_place_id, mode('driving'|'walking'|'transit'), duration_sec, distance_m, fare_text, polyline, raw_json, computed_at |

- 「ピン」は独立テーブルにせず `places` を地図表現とする (lat/lng を持つ place がピン)。
- Kindle 連番画像は `place_images(kind='source', order_index=連番)` で受け、**右→左連結**した 1 枚を
  `kind='composite'` として保存する。`image_analyses` は composite を解析対象にする。

## 4. 特徴機能のフロー

### 4.1 施設サマリー (名前/URL → クロール → 要約)
`POST /places/:id/crawl` … source_url か name から候補URLを得て PoliteFetcher で取得 →
本文抽出 → LLM(haiku 相当)で `summary`/`category`/`address` を構造化抽出 → places を更新。
住所が取れたら Geocoding して lat/lng をセット (= 自動ピン)。

### 4.2 Kindle 連番画像 → 右→左連結
`POST /places/:id/images` で連番画像を複数アップロード (order_index 付き) →
`POST /places/:id/images/compose` で **order_index 降順=右→左** に横連結 (sharp) し composite を保存。
和書の見開き/扉絵は右から左へ読むため、連結も右→左を既定にする。

### 4.3 画像を解析 (vision)
`POST /images/:id/analyze` … composite を LLM(vision) に渡し、写っている内容・テキストを読み取って
`analysis_text` に格納。住所/施設名が判明したら `extracted_address` → Geocoding → place の lat/lng と
address を補完し、地図にピンを立てる。

### 4.4 経路探索
`POST /days/:id/route` … その日の itinerary_items の place 列を順に Google Routes API
(Compute Routes, POST + fieldMask) へ投げ、mode 別の所要時間/距離/運賃/polyline を route_legs に保存。
日本の鉄道乗換が要件化したら NAVITIME/駅すぱあとを後段で追加 (二段構え)。

### 4.5 PDF しおり出力
`GET /trips/:id/pdf` … しおり HTML (日付ごとの予定 + 地図サムネ + 場所サマリ + 連結画像) を組み、
Puppeteer (headless Chrome) で印刷向け PDF にレンダリングして返す。

## 5. プロトタイピング段階 (prototyping-flow)

- Step1 (粗く動かす): データモデル + 各機能の縦割り API + 地図/しおりの最小 UI。SQLite ローカル完結。
- Step2 (分類別リファクタ): packages へ責務分離 (places/crawl/llm/image/routing)、SRP/ファイル分割。
- Step3 (結合確認): PWA として iOS で通し操作。SaaS 化する場合は Cernere 認証 + Corpus 連携を別途。

## 6. 未決 / TODO

- Google Maps / Routes / Places の API キー入手と referrer 制限設定 (secret 経由)。
- claude CLI の vision 入力方式の確定 (画像パス渡し)。
- PDF レイアウトの体裁 (印刷余白/折りたたみ)。
- 認証: 単独利用は dev 固定ユーザ、共有時に Cernere 連携。
