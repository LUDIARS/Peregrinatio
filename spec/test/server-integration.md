# server 統合テスト

## 何を担保するか

API ルート (Hono) を、本番と同じ SQLite migration を適用した使い捨て DB 上で
実 HTTP リクエスト (`app.request()`) として叩き、ドメインの不変条件が壊れないことを固定する。
モックではなく実 SQL を通すので、SQL 方言変換 (`sqlite-driver`) や migration の整合も同時に検証される。

## 仕組み

- `apps/server/src/app.ts` … `buildApiApp()` がルートだけを束ねた Hono を返す (serve / 静的配信から分離)。
  起動 (`index.ts`) もテストも同じ app を組む。
- `apps/server/src/test/db.ts` … `setupTestDb()` が OS 一時ディレクトリに一意の SQLite を作り
  migration を適用、`teardownTestDb()` が WAL チェックポイント後に close + 削除。
  **実 DB (`data/peregrinatio.sqlite`) は絶対に触らない** (毎テスト一意 temp パス)。
- 各テストは `beforeEach` で `trips` / `places` / `trip_places` を空にして独立させる。

## 現在のカバレッジ

- `routes/places.test.ts` — 場所ライブラリ (全旅共有) と旅↔場所メンバーシップ
  - 新規場所追加でライブラリにも 1 件入る
  - **既存ライブラリ場所を `place_id` で別の旅にも紐付けられる (場所は重複しない)** = 使い回し (UI: LibraryPicker)
  - 同一場所の二重追加でも membership は 1 件 (`INSERT OR IGNORE`)
  - 旅から外しても場所はライブラリに残る (恒久ライブラリ)
  - `?status` / `?q` でライブラリ絞り込み
  - `is_base` 切替 (メンバーシップ単位)
- `routes/trips.test.ts` — 旅のライフサイクル
  - title 無しは 400 / 作成→一覧→取得 (TripDetail 形) / 404 / アーカイブ→完全削除の 2 段階 /
    旅削除でも場所はライブラリに残る

## やること (未カバー)

- 機能ルータ (crawl / search / images / routing / pdf / recommend / base-summary) は
  外部 (Google API / claude CLI / puppeteer) 依存のため未カバー。
  packages 側の純ロジック (crawl の extract/robots、llm の json) は各 package の unit test で担保。
- days / itinerary ルートの統合テスト。

## 実行 / CI

- ローカル: `npm test`(= 全 workspace の `vitest run`)、または `npm test --workspace apps/server`。
- CI: `.github/workflows/ci.yml` が PR / main push で `npm ci → build → test` を全 workspace に対し実行。
  node:sqlite を実験フラグ無しで使うため Node 24 系。Puppeteer の Chromium DL は `PUPPETEER_SKIP_DOWNLOAD` で省略。
