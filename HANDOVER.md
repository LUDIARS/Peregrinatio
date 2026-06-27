# Peregrinatio (Pe) 引き継ぎ資料

旅行用の「気になる場所」と「日程(旅のしおり)」を作る **iOS メイン PWA**。ラテン語 peregrinatio=旅。

- リポ: https://github.com/LUDIARS/Peregrinatio （ローカル `E:\Document\Ars\Peregrinatio`）
- 公開URL: **https://peregrinatio.vtn-game.com** （Cloudflare Tunnel → ローカル server:8090）
- 下敷き: Tirocinium(Tr) の Map ビュー/サマリー処理を流用

## 起動・開発

```bash
cd E:\Document\Ars\Peregrinatio
npm install                 # @ludiars/encrypted-config 取得に .npmrc + NODE_AUTH_TOKEN(gh token) が要る
# 秘密: Google Maps APIキーは暗号化configに格納 (平文env不可)
npm run config-set GOOGLE_MAPS_API_KEY <値 or @ファイル>
npm run migrate             # SQLite (data/peregrinatio.sqlite) にマイグレーション適用
npm run dev                 # server:8090 + web:5179 を同時起動
```

- **本番(単一オリジン)**: `npm run build:web` 後、server が `apps/web/dist` を `/` 配信(SPAフォールバック)。server は `npm start`(= `cd apps/server && tsx src/index.ts`) で起動。packages が `"type":"module"` で exports が src 指しのため `node dist/index.js` は使わない(tsx 経由が正)。
- web のフロント変更のみなら `npm run build:web` だけで稼働 server が即反映(serveStatic がディスク配信)。server コード/マイグレーション変更時は server 再起動が必要。

## 構成 (npm workspaces monorepo)

```
apps/server   Hono + SQLite(node:sqlite, 既定。databaseUrl で Postgres 切替余地)
apps/web      React + Vite + vite-plugin-pwa
packages/     llm(claude CLI), crawl(PoliteFetcher+抽出), places(Places/Geocode/Photo),
              image(連番右→左連結 sharp), routing(Routes API)
```
port: server=8090 / web(dev)=5179 / docker Postgres=15433。

## データモデル (migration 001-005)

- **場所=全旅共有の恒久ライブラリ** (`places`)。旅↔場所は `trip_places(trip_id,place_id,is_base,added_at)` で紐付け → **旅を削除しても場所は残る**。
- `places`: name/address/lat/lng/category/source_url/summary/notes/**image_url**/**status**('interested'気になる/'visited'訪問済み/'none')。
- `place_links`: 資料Webページ(複数)。`place_images`/`image_analyses`: Kindle連番画像と解析。`trip_days`/`itinerary_items`/`route_legs`: 日程と経路。
- `trips.archived`: アーカイブ(ゴミ箱)→完全削除の2段階。
- **耐久性**: `synchronous=FULL` + 終了時 WAL チェックポイント + SIGINT/TERM で安全close。マイグレーションはテーブル再構築のため `foreign_keys=OFF` で適用(`runMigrations`)。

## 秘密 / 鍵

- `@ludiars/encrypted-config`(Lapilli, AES-256-GCM) で `peregrinatio.config.json`(gitignore, マシン束縛master鍵)に格納。`apps/server/src/secrets/store.ts`。登録は `npm run config-set`。
- Google Maps キーは gcloud で作成済「Peregrinatio Maps」(project nodal-vigil-495107-d1。API制限: Maps JS/Places New/Geocoding/Routes/Directions)。`map-config` enabled=true。
- claude CLI vision はヘッドレス可: `claude -p --allowedTools Read --add-dir <dir>` でプロンプトに画像の絶対パス(Windows は server プロセスに `CLAUDE_CODE_GIT_BASH_PATH` 要)。

## 主な機能 (実装・デプロイ済)

地図(拠点中心・周囲~10-30km/z11)、周辺施設検索(Places)、施設サマリー(クロール→LLM)、Kindle連番画像の右→左連結、画像解析(vision→住所→ピン)、PDFしおり出力、**おすすめ自動収集**(拠点周辺Places検索→登録+公式サイト資料リンク+Places写真)、**Web/Places画像取得**、**拠点サマリー自動生成**(daemon)、**日程の自動経路**(車/徒歩/自転車)、状態フィルタ。
- UI: PC=3カラム(一覧左/地図中/詳細右) / モバイル=地図ベース+左上☰ドロワー+詳細ポップアップ。旅一覧=計画/過去/アーカイブ。
- **グローバルナビ (NavMenu)**: 5セクション (マップとメモ/旅のしおり/情報追加/時刻表・運行情報/設定)。モバイル=下部フッタータブ / PC=画面上を移動できる「インタラクティブメニュー」(☰折りたたみ⇔展開、位置は localStorage 永続)。旅未選択時は旅依存項目を無効化。`apps/web/src/components/NavMenu.tsx`。
- **場所を検索 (地図オーバーレイ)**: 旧インテリジェント検索のキーワード検索分を地図上のオーバーレイ化 (`components/MapSearchOverlay.tsx`)。URL/画像からの情報追加は独立ページ「情報追加」(`pages/AddInfo.tsx`、`lib/enrich.ts`) に分離。
- **日程の自動決定**: 旅作成時に開始日〜終了日から trip_days を日付つきで自動生成 (`POST /api/trips`、`lib/dates.ts`)。しおり (カンバン) で日付をインライン編集可。
- **拠点ホテルの IN/OUT**: 拠点の詳細で公式サイトから自動取得 (`POST /api/trips/:id/places/:pid/hotel-times`、クロール→LLM) + 手動調整。`trip_places.checkin_time/checkout_time`。
- **時刻表/運行情報**: 区間ボード+便+運行情報を手入力で管理 (`pages/Transit.tsx`、`routes/timetable.ts`)。しおりの「移動を追加」で時間帯が合う便を候補表示→移動カード化。**自動取得 (fetch/refresh) を provider 化** (`apps/server/src/transit/`): `crawl-llm`=時刻表/運行情報ページの URL をクロール→LLM(claude CLI)抽出 (契約・キー不要・既定) / `ekispert`=駅すぱあと契約 (`EKISPERT_API_KEY` 登録時のみ有効、区間 from/to で経路探索)。`GET /api/transit/config` が利用可能 provider を返し、UI は provider 選択+URL 入力を出す。未設定 provider/URL 欠落は silent fallback せず明示エラー (501/400)。

## 既知の制約・残作業

1. ~~**サーバ常駐化未了**~~ 🚫 見送り (ユーザ判断: 不要)。
2. ~~**本番起動経路修正**~~ ✅ 対応済 — `apps/server/start` を `tsx src/index.ts` に変更。`npm start` で起動可能。`node dist/index.js` は packages exports が src 指しのため使わない。
3. **電車経路(transit)** — Google が当アカウントで ZERO_RESULTS(保留)。要 NAVITIME/駅すぱあと(契約)。
4. **コード登録PR未マージ** — LUDIARS#42(PROJECT-CODES.md) / Castra#33(CLAUDE.md)。
5. ~~**ライブラリ既存場所の使い回しUI未配線**~~ ✅ 対応済 — 旅詳細の中央カラムに「📚 ライブラリから既存の場所を追加」(`LibraryPicker`) を配線。`GET /api/places` で全旅共有ライブラリを引き、すでにこの旅にいる場所を除外し、選んで `POST /api/trips/:id/places { place_id }` で紐付ける。
6. **claude CLI 連携の本番実走未検証** — 稼働server上で vision/自動Web収集/拠点サマリーが claude CLI 経由で通るか要確認。
7. ~~**認証なし(誰でも閲覧/編集可)**~~ 🚫 見送り (ユーザ判断: 不要)。
8. ~~**PDF体裁/日本語フォント実機未確認**~~ ✅ 対応済 — PDF しおりを**旅行ツアーのパンフレット(行程表)風**に刷新。テンプレートを `apps/server/src/pdf/brochure.ts`(`buildBrochureHtml`)に分離し、表紙(ヒーロー写真+日程サマリチップ)→行程概要→日ごとのタイムライン(スポットカード=写真/カテゴリ/住所/概要 + 移動コネクタ)。ページ番号フッター付き。Puppeteer 実レンダリングで日本語フォント(Yu Gothic/Meiryo)表示を確認済。
9. ~~**テスト/CI 未整備**~~ ✅ 対応済 — `apps/server/src/app.ts`(`buildApiApp`)でルートを分離し、使い捨て SQLite + 本番 migration 上で `app.request()` する統合テスト (`routes/places.test.ts` / `routes/trips.test.ts`、計11) を追加。`.github/workflows/ci.yml` が PR/main push で全 workspace の `npm ci → build → test` を実行 (Node 24)。spec は `spec/test/server-integration.md` に方針を記載。残: days/itinerary や外部依存ルートの統合は未カバー。
10. 軽微: recommend の半径指定UI無し / og:image 相対URL絶対化未対応。
11. 保留: リゾナーレ那須(49件)再シード要否は未回答。
12. ~~**時刻表/運行情報のデータ源未配線**~~ ✅ 対応済 — `apps/server/src/transit/` に provider 抽象 (`crawl-llm`/`ekispert`) を実装。`crawl-llm` は URL クロール→LLM 抽出で**契約不要・即利用可**。`ekispert` (駅すぱあと) は `npm run config-set EKISPERT_API_KEY <値>` 登録で有効化 (※実応答 JSON 形は契約キーでの実走で要検証。写像 `mapEkispertDepartures` を純関数分離+単体テスト済)。運行情報 refresh は crawl-llm のみ対応 (ekispert は別契約 API のため未対応=501 明示)。
13. **server 再起動が必要** — 今回の改修は server コード + migration (006/007) を含む。稼働 server (8090) はフロント (build:web) は即反映だが、新ルート/日程自動生成/IN/OUT/時刻表を有効にするには `npm run migrate` 済 + server 再起動が必要。
