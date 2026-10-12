# 新幹線・特急の時刻表取り込みと往復便の提案

## 目的

旅の往路・復路 (出発地点 ↔ 拠点) の長距離移動を、取り込んだ新幹線・特急の時刻表から
**実際に乗れる便** として提案する。現状のプラン提案は往復を「別手配」のメモ行にしており、
那須方面の「なすの」だけがコードに直書きされている (`routes/timetable.ts` の
`TOHOKU_SHINKANSEN_NASUNO_*`)。これを全路線で使える時刻表ライブラリに置き換える。

## 原則

- 時刻表は **旅をまたいで共有するライブラリ** (場所ライブラリと同じ考え方)。旅を消しても残る。
- 取り込みは **プレビュー → 保存** の 2 段。解析結果を見せてから保存する。
- 便の提案は DB を変えない。採用 (しおりへの移動カード化 / プラン採用) だけが書き込む。
- 時刻表が無い・駅が特定できないときは黙って概算に落ちない。理由を `warnings` に出し、従来の「別手配」メモ行にする。

## データ (新規 migration)

| テーブル | 主な列 | 内容 |
|---|---|---|
| `express_lines` | id, name, kind (`shinkansen` / `limited_express`), operator, source_url, valid_from (YYYY-MM-DD, null 可), notes, imported_at | 路線 (例: 東北新幹線、特急ひたち) |
| `express_stations` | line_id, seq, name, lat, lng | 路線上の停車駅を下り方向の順で。座標は駅名 + 「駅」で Geocoding して保存 (失敗は null・画面で手修正可) |
| `express_trains` | id, line_id, direction (`down` / `up`), train_name, service_note (`daily` / `weekday` / `holiday` / 自由文) | 1 本の列車 |
| `express_stop_times` | train_id, station_seq, arrive_time, depart_time | 'HH:MM'。日付またぎは 24:xx 表記を許す。通過駅は行を持たない |

`timetables` / `timetable_departures` (旅ごとの区間ボード) はそのまま残す。
しおりで便を採用したときは、従来どおり旅の区間ボードへ写して移動カードにする。

## 取り込み

`POST /api/express/import/preview` → `{ line, stations[], trains[], warnings[] }` (保存しない)
`POST /api/express/import` (preview と同じ形を受け取り単一トランザクションで保存) / `DELETE /api/express/lines/:id`
`GET /api/express/lines` / `GET /api/express/lines/:id` (駅・列車・時刻)

入力は 2 通り。

1. **表の貼り付け** (主経路、決定的): 紙・PDF の時刻表と同じ「縦に駅、横に列車」の表を TSV/CSV で貼る。
   1 行目 = 列車名、2 行目以降 = `駅名, 時刻...`。セルは `6:20` / `06:20` / `↓` `レ` `||` (通過) / 空欄 (非経由) /
   `着6:20` `発6:22` の着発併記。方向は入力で指定 (`down` / `up`)。純関数のパーサで単体テストする。
2. **URL / PDF から抽出**: 既存の `crawl-llm` provider の経路 (クロール → claude CLI 抽出) で同じ JSON 形を作り、
   プレビューに載せる。LLM 出力は駅順・時刻の単調増加を検証し、崩れた列車は落として `warnings` に出す。
   取得や抽出に失敗したら 502 / 400 で明示エラーにする (貼り付けへ誘導する文言を返す)。

既存の「なすの」直書きデータは seed として本ライブラリへ移し (路線 = 東北新幹線、停車駅 = 東京・上野・大宮・
小山・宇都宮・那須塩原 のうち時刻のある駅)、`tohoku-shinkansen-seed` / `tohoku-shinkansen-bus-suggestions`
は下の汎用 API に置き換えて削除する (Web の呼び出し側も差し替える)。

## 便の提案

`POST /api/trips/:id/express/suggest` → `{ outbound: ExpressOption[], inbound: ExpressOption[], warnings[] }`

1. **乗車駅**: 出発地点 (自宅 / 集合地点の座標) に最も近い、取り込み済み路線の駅。50km を超えたら候補外。
2. **降車駅**: 拠点に最も近い駅 (同じ路線上)。拠点が無ければ旅の最初の場所。
3. 往路は旅の初日、復路は最終日。方向は駅の seq の大小で決める (乗車 seq < 降車 seq なら `down`)。
4. 運行日: `weekday` / `holiday` は曜日で判定 (土日 = holiday)。祝日は判定しないので、該当日なら「祝日ダイヤの可能性」を warnings に出す。
5. 往路の候補: 降車駅着 + 端末交通 (降車駅 → 拠点) がチェックイン時刻 (無ければ 15:00) までに収まる便を、
   **遅い順に 3 本** (着いてすぐ遊べる早い便も選べるよう、最も早い便も 1 本足して最大 4 本)。
   端末交通は既存の GTFS 接続検索 (`findStopConnections`) で実便を探し、無ければ `plan-travel` の概算 (タクシー=車) で出す。どちらを使ったかを示す。
6. 復路の候補: 拠点のチェックアウト時刻 (無ければ 10:00) + 端末交通の後に乗車駅を出る便を **早い順に 3 本**。
   プラン提案から呼ぶときは「最終日の行動が終わって拠点を出る時刻」を起点にする。
7. 出発地点 → 乗車駅の所要は概算 (`plan-travel`) で出し、「家を出る時刻」を併記する。
8. 時刻表の `valid_from` が旅の日付より 1 年以上前なら「ダイヤ改正の可能性」を warnings に出す。

`ExpressOption` = 列車名・路線・乗車駅・発時刻・降車駅・着時刻・端末交通 (手段・所要・GTFS 便名)・家を出る時刻 / 家に着く時刻・`source` (`express_timetable`)。

### プラン提案との接続

`plan-transit-build` と概算方式の両方で、往路・復路の「別手配」メモ行を、提案の先頭候補の移動行
(`duration_source='express_timetable'`、便名・発着時刻) に差し替える。初日の行動開始は降車駅着 + 端末交通、
最終日の行動終了は復路便の乗車に間に合う時刻で打ち切る。候補が無ければ従来のメモ行のまま、理由を warnings に出す。
画面 (`PlanDayPreview`) では往復の行で他の候補便に切り替えられる。

### しおりの「移動を追加」

既存の時間帯一致候補に、ライブラリの便 (乗車駅・降車駅を選ぶ) も並べる。採用時は旅の区間ボードに写す。

## 画面

「時刻表・運行情報」セクションに「新幹線・特急の時刻表」タブを足す: 路線一覧 / 取り込み (貼り付け or URL) / プレビュー表 / 駅座標の手修正。

## 範囲外

- 祝日カレンダー、臨時列車、指定席の空席・予約。
- ODPT / 駅すぱあと API による全国自動取得 (別 provider として後で足せる形にだけしておく)。

## 実装メモ (2026-10-13)

- 置き場所: `apps/server/src/express/` (セル・表パーサ / 取り込み検証 / LLM 抽出 / 駅座標 / 運行日 / 駅選択 /
  便選択 / 端末交通 / 提案 / 区間ボードへの写し / DB)、`routes/express.ts`、migration `022_express_timetables.sql`。
  プランとの接続は `suggest/plan-express.ts` (便 → プランの行)。
- 設計に足した API: `PATCH /api/express/lines/:id/stations/:seq` (駅座標の手修正)、
  `GET /api/express/lines/:id/segments` (しおりの「移動を追加」で乗車駅・降車駅を選んだときの便)、
  `POST /api/trips/:id/express/adopt` (便を旅の区間ボードへ写す)、`POST /api/express/import` の `replace_line_id` (路線の置き換え)。
- 取り込みは方向ごとに 1 枚の表を受け、上り表は駅を逆順にしてから下り順に合わせる (停車駅が違う表は、既知の駅の直後に差し込んで 1 本の駅順にまとめる)。
  通過記号・非経由は NFKC 後の形で判定し、読めないセルは空欄扱いで warnings に出す。駅名列の「着」「発」2 行は 1 駅にまとめる。
- URL 取り込みは拡張子 / Content-Type が PDF なら一時ファイルに落として claude CLI の Read ツールで読ませ、それ以外は crawl-llm と同じ経路。
  LLM 出力が JSON として読めないときは 502 (貼り付けへ誘導)。駅一覧に無い駅名を含む列車は検証で落とす。
- 端末交通: 列車を降りてからバス・タクシーに乗るまで / 拠点を出てから駅に入るまで 10 分の余裕を見る。
  「家を出る時刻」は 発時刻 − 駅までの概算 − 10 分。
- 往復便の行は 出発地点→乗車駅 / 列車 / 降車駅→拠点 (復路は逆) の 3 行。各行に `express_ref` を付け、プラン提案の応答 `express` に
  候補ごとの行の組を入れて、画面ではその組で差し替える (前後の予定の時刻は動かさない)。
- seed の「なすの」は旧直書きデータのとおり東京・那須塩原の 2 駅 (時刻のある駅) だけを持つ。`valid_from=2022-03-19` なので、
  現在の旅ではダイヤ改正の警告が出る (正しい挙動)。

## 条項

- `SPEC-EXPRESS-LIBRARY`: 新幹線・特急の時刻表は旅をまたいで共有するライブラリ (路線・下り seq 順の駅・列車・停車時刻) として保存し、旅を消しても残る。駅座標は手修正できる。
- `SPEC-EXPRESS-IMPORT`: 取り込みはプレビュー → 保存の 2 段。表の貼り付け (決定的パーサ) と URL / PDF の LLM 抽出のどちらも、駅順と時刻の単調増加を検証して崩れた列車を warnings 付きで落とし、取得・抽出の失敗は 502 / 400 で明示する。
- `SPEC-EXPRESS-SUGGEST`: 往路はチェックインまでに拠点へ着ける便を遅い順に 3 本 + 最早便、復路は拠点を出た後の便を早い順に 3 本提案する。乗車駅は出発地点から 50km 以内の最寄り駅、端末交通は GTFS → 無ければタクシー概算。提案は DB を変えない。
- `SPEC-EXPRESS-PLAN`: プラン提案の往路・復路の「別手配」メモ行を先頭候補の便の行に差し替え、初日の行動開始と最終日の行動終了を便に合わせる。画面で他の候補便に切り替えられる。便が無ければメモ行のまま理由を warnings に出す。
- `SPEC-EXPRESS-ITINERARY`: しおりの「移動を追加」にライブラリの便 (乗車駅・降車駅を選ぶ) を並べ、採用したら旅の区間ボードへ写して移動カードにする。
- `SPEC-EXPRESS-UI`: 「時刻表・運行情報」に「新幹線・特急の時刻表」タブ (路線一覧 / 取り込み / プレビュー表 / 駅座標の手修正 / 往復便の提案) を置く。

## ファイルと役割

| ファイル | 役割 | 条項 |
|---|---|---|
| `apps/server/src/express/types.ts` | ライブラリ・取り込み・提案の型 | SPEC-EXPRESS-LIBRARY |
| `apps/server/src/express/repository.ts` | 路線・駅・列車・停車時刻の DB 読み書き (保存は単一トランザクション) | SPEC-EXPRESS-LIBRARY |
| `apps/server/src/express/time-cell.ts` | 時刻表の 1 セル (時刻 / 通過 / 非経由 / 着発併記) を読む | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/table-parse.ts` | 縦に駅・横に列車の表 (TSV/CSV) を読む | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/paste-import.ts` | 方向ごとの表を下り順の 1 路線にまとめる | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/import-validate.ts` | 取り込みデータの検証・正規化 (崩れた列車を warnings 付きで落とす) | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/llm-extract.ts` | URL (HTML / PDF) から LLM で抽出する | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/import-preview.ts` | プレビューを作る (保存しない) | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/station-geocode.ts` | 駅名 + 「駅」で座標を付ける | SPEC-EXPRESS-IMPORT |
| `apps/server/src/lib/csv.ts` | CSV の行分割 (`parseCsvRows`) を貼り付けの表にも使う | SPEC-EXPRESS-IMPORT |
| `apps/server/src/express/service-day.ts` | 運行日 (daily / weekday / holiday) と ダイヤ改正の判定 | SPEC-EXPRESS-SUGGEST |
| `apps/server/src/express/station-pick.ts` | 乗車駅・降車駅を決める | SPEC-EXPRESS-SUGGEST |
| `apps/server/src/express/train-select.ts` | 往路・復路の便を選ぶ | SPEC-EXPRESS-SUGGEST |
| `apps/server/src/express/terminal-transport.ts` | 端末交通 (GTFS バス → タクシー概算) | SPEC-EXPRESS-SUGGEST |
| `apps/server/src/express/suggest.ts` | 旅の往復便の提案 (DB は読むだけ) | SPEC-EXPRESS-SUGGEST |
| `apps/server/src/express/board-copy.ts` | 便を旅の区間ボードへ写す | SPEC-EXPRESS-ITINERARY |
| `apps/server/src/routes/express.ts` | HTTP API | 全条項 |
| `apps/server/src/routes/timetable.ts` | 旅の区間ボード (なすの直書きを削除) | SPEC-EXPRESS-LIBRARY |
| `apps/server/src/suggest/plan-express.ts` | 便をプランの行 (候補ごとの組) に変える | SPEC-EXPRESS-PLAN |
| `apps/server/src/suggest/plan.ts` / `plan-build.ts` / `plan-transit-build.ts` | 初日・最終日に便の行を置き、行動時間を便に合わせる | SPEC-EXPRESS-PLAN |
| `apps/server/src/suggest/types.ts` / `plan-adopt-input.ts` / `plan-adopt.ts` | `express_timetable` の所要の出所・`express_ref`・採用時のメモ | SPEC-EXPRESS-PLAN |
| `apps/web/src/components/transit/ExpressTimetableTab.tsx` | 「新幹線・特急の時刻表」タブ | SPEC-EXPRESS-UI |
| `apps/web/src/components/transit/ExpressImportForm.tsx` | 取り込みフォーム (貼り付け / URL) | SPEC-EXPRESS-UI |
| `apps/web/src/components/transit/ExpressTimetableGrid.tsx` | プレビュー・路線詳細の表 | SPEC-EXPRESS-UI |
| `apps/web/src/components/transit/ExpressStationCoords.tsx` | 駅座標の手修正 | SPEC-EXPRESS-UI |
| `apps/web/src/components/transit/ExpressTripSuggest.tsx` | この旅の往復便の提案と区間ボードへの写し | SPEC-EXPRESS-UI |
| `apps/web/src/components/transit/TransitPanel.tsx` / `TimetableSection.tsx` | タブの切り替え・旧なすの UI の削除 | SPEC-EXPRESS-UI |
| `apps/web/src/components/itinerary/ExpressMovePicker.tsx` / `apps/web/src/pages/Itinerary.tsx` | しおりの「移動を追加」にライブラリの便 | SPEC-EXPRESS-ITINERARY |
| `apps/web/src/components/plan/PlanDayPreview.tsx` / `PlanSuggestPanel.tsx` / `plan-express-switch.ts` / `apps/web/src/components/plan/plan-format.ts` | プラン案の往復便の候補切り替えと表示整形 | SPEC-EXPRESS-PLAN |
| `apps/web/src/api.ts` / `apps/web/src/types.ts` | API クライアントと型 | SPEC-EXPRESS-UI |
