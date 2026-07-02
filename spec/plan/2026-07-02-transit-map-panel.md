# 時刻表 UI のマップ画面統合 (左パネル「経路」モード)

- 日付: 2026-07-02
- ブランチ: `feat/transit-map-panel`

## 目的

バス/新幹線の時刻表を別画面 (`/trips/:tripId/transit`) にせず、
メイン画面 (マップとメモ) の地図を見ながら確認できるようにする。
左に出てくるメニュー (PC=左カラム / モバイル=ドロワー) を
「場所」⇔「経路」で切り替える。

## 設計判断

| 項目 | 判断 |
|------|------|
| 切替の持ち方 | URL クエリ `?panel=transit` と同期。フッターの「時刻表/運行」タブはこの URL に遷移する (直リンク・リロード耐性) |
| 旧ページ | `pages/Transit.tsx` は削除。`/trips/:tripId/transit` は `?panel=transit` へ後方互換リダイレクト |
| GTFS 路線の地図 | `GtfsTimetable` に `map` prop (外部地図) を追加。経路パネルからはメイン地図 (mapInstance 常駐) に停留所・順路を直接描画。prop 無しなら従来のミニ地図 (フォールバック) |
| 地図の後始末 | 路線切替時は再描画前に全消去、アンマウント時 (経路→場所切替含む) にも全消去してメイン地図に残さない |
| モバイル | `?panel=transit` に入ったらドロワーを自動で開く (フッタータブから一手で見える)。ドロワーは 86% 幅なので背後の地図が見える |
| SRP 分割 | 旧 Transit.tsx の同居 4 責務を `components/transit/` に分割: `TransitPanel` (合成+データ読込) / `TimetableSection` (手入力時刻表) / `ServiceAlertsSection` (運行情報) / `ReservationSuggests` (予約サジェスト) / `ProviderPicker` (取得方法入力 + TransitCfg) |

## 変更ファイル

- `apps/web/src/pages/TripDetail.tsx` — 左パネルに 場所/経路 トグル、経路時は `TransitPanel` を表示
- `apps/web/src/components/transit/*` — 新設 (上記分割)
- `apps/web/src/components/GtfsPanel.tsx` / `GtfsTimetable.tsx` — `map` prop 追加 (メイン地図へ描画)
- `apps/web/src/components/NavMenu.tsx` — 「時刻表/運行」→ `?panel=transit`、点灯判定にクエリを考慮
- `apps/web/src/main.tsx` — 旧 `/transit` ルートをリダイレクト化
- `apps/web/src/pages/Transit.tsx` — 削除
- `apps/web/src/styles.css` — `.ws-mode-bar` / `.transit-panel` 追加

## 検証

- `npm run build:web` (tsc + vite) green
- `vitest run` 6/6 green (worktree は lockfile の vitest 2.1.9 が Node 24 で
  tinypool IPC クラッシュするため `--pool=threads` で実行。テスト自体は既存分のみ)
