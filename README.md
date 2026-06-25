# Peregrinatio (Pe)

旅行用の「気になる場所」と「その日の行動予定」をまとめる **旅のしおり PWA**。

ラテン語 *peregrinatio* = 旅・旅行・遍歴。

## できること

- **地図で目的地を決める** — Google Map で旅行先を大まかに選び、周辺施設を検索する。
- **施設をサマる** — 施設名や URL から Web 情報をクロールし、LLM で要約して記録する。
- **ピンを立てる** — 気になる場所を地図にピン留めし、しおりに紐づける。
- **Kindle 連番画像の取り込み** — ガイド本の扉絵など連番画像を受け付け、**右→左の順で 1 枚に連結**して記録する。
- **画像を解析** — 連結画像を LLM(vision) で読み取り補足情報を格納。住所が判明したら地図にピンを立てる。
- **経路探索** — 何日に何処から何処へ移動するかを Google Routes API で探索する(徒歩/車/公共交通)。
- **PDF しおり出力** — しおりを PDF にエクスポートして印刷できる。

## 使い方の主戦場

iOS Safari での操作をメインに据えた **PWA**(ホーム画面追加で全画面動作)。
写真ライブラリからの画像取り込みを前提にする。

## 構成

npm workspaces monorepo (Tirocinium の構成を下敷き)。

```
apps/
  server/        Hono + (SQLite 既定 / Postgres 切替) API
  web/           React + Vite PWA フロントエンド
packages/
  places/        Google Places 検索 + Geocoding
  crawl/         PoliteFetcher (robots 準拠) + 施設情報抽出/要約
  llm/           claude CLI/API コンプリータ + vision 解析
  image/         連番画像の右→左連結 (sharp)
  routing/       Google Routes API クライアント
spec/            AIFormat 規約の仕様 (data/feature/interface/setup/test)
```

## 開発

```bash
npm install
# DB は既定 SQLite (data/peregrinatio.sqlite)。Postgres を使う場合のみ:
#   npm run db:up   # docker compose で Postgres 起動
npm run migrate
npm run dev        # server + web を同時起動
```

詳細は `DESIGN.md` と `spec/` を参照。
