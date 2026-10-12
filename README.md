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
- **持ち物を提案する** — 宿の設備と行き先・季節から持ち物を提案する (乾燥機あり→着替えは少なめ、プール/海→水着、秋→紅葉の支度、夏→日避け)。
- **プランを自動で決める** — 交通手段を軸に、拠点の最寄り駅から数駅ぶんの範囲で、移動時間と滞在時間が 1 日に収まる日割り案を作る。
- **新幹線・特急の時刻表** — 時刻表 (縦に駅・横に列車の表の貼り付け / URL・PDF からの LLM 抽出) を旅をまたいだライブラリに取り込み、出発地点 ↔ 拠点の往路・復路で実際に乗れる便を提案する。プラン提案の「別手配」行もこの便に置き換わる。
- **周辺候補のアクセス印** — 場所一覧・詳細・プランの新しい候補・場所検索の結果に 🚕 タクシー初乗り圏 / 🚏 バス停近い / 🚌 シャトルあり を付け、車が無くても行けるかを一目で分かるようにする。
- **PDF しおり出力** — しおりを PDF にエクスポートして印刷できる。

## 使い方の主戦場

iOS Safari での操作をメインに据えた **PWA**(ホーム画面追加で全画面動作)。
写真ライブラリからの画像取り込みを前提にする。

## 構成

npm workspaces monorepo (Tirocinium の構成を下敷き)。

```
apps/
  server/        Hono + (SQLite 既定 / Postgres 切替) API
    src/suggest/ 荷物・季節・プランの提案 (提案は読むだけ / 採用だけが書く)
    src/express/ 新幹線・特急の時刻表ライブラリ (取り込み・往復便の提案)
    src/access-marks/ 周辺候補のアクセス印 (🚕/🚏/🚌 の判定)
    src/security/ Cloudflare Access の JWT 検証 (公開入口の多重防御)
  web/           React + Vite PWA フロントエンド
packages/
  places/        Google Places 検索 + Geocoding
  crawl/         PoliteFetcher (robots 準拠) + 施設情報抽出/要約
  llm/           claude CLI/API コンプリータ + vision 解析
  image/         連番画像の右→左連結 (sharp)
  routing/       Google Routes API クライアント
spec/            AIFormat 規約の仕様 (data/feature/interface/setup/test)
```

## 公開入口と Cloudflare Access

公開入口 (`pe.ai-run-do.com`、LOCAL Tunnel → 127.0.0.1:8091) は Cloudflare Access で本人だけに絞る。
共有リンク (`/s/:token`) も鍵の内側 (例外パスなし)。Cloudflare 側の設定は Excubitor の CF ブローカーで行い、
アプリは runtime-config (`EXCUBITOR_SERVICE_CONFIG_JSON.cloudflareAccess.{teamDomain,audience}`) があるとき、
ループバック以外から来た要求の `Cf-Access-Jwt-Assertion` を検証する (失敗は 403 + 理由コード)。
設定が無ければ検証せず、起動ログに「Access 検証: 無効」と出る。詳細: `spec/feature/cf-access.md`。

## 開発

```bash
npm install
# DB は既定 SQLite (data/peregrinatio.sqlite)。Postgres を使う場合のみ:
#   npm run db:up   # docker compose で Postgres 起動
npm run migrate
npm run dev        # server + web を同時起動
```

詳細は `DESIGN.md` と `spec/` を参照。
