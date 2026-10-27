# GTFS ZIP の展開量とダウンロード量を制限する

## 実装内容

ZIP の deflate に maxOutputLength を指定し、stored のコピー前にもサイズを検査する。エントリは 512 MiB、全エントリは 1 GiB を上限にし、残り合計予算より大きい展開を途中で拒否する。同名エントリも累積する。

取得本文は逐次読み取りに変更し、Content-Length と実受信量の双方で既存の 80 MiB 上限を適用する。超過時はキャンセルし、reader は必ず解放する。既存のサイズ超過文言と展開エラー経路を維持する。

再利用探索: 既存の unzip / importGtfsFromUrl と合成 ZIP fixture を採用した。標準の node:zlib と ReadableStream だけで解決できるため、外部 ZIP パッケージやダウンロード依存は追加しない。依存・ロックファイル・導入スクリプトに変更はなく、新たな間接依存もない。契約観測は Augur の正規テンプレートをプロジェクト内へ同期した。

上限の根拠: 既存 fixture はテスト内の小さな合成 ZIP のみ。大きな stop_times.txt に余裕を持たせる値として依頼指定の 512 MiB / 1 GiB を採用した。実際の GTFS-JP フィードの最大値は未計測。超過フィードは明示拒否する。境界テストには内部の縮小予算を使い、利用者向け設定は追加しない。

通信・メモリ確認: 本番の既存 fetch は入力された ZIP URL を取得する用途を維持し、認証情報や新しい送信データは加えていない。テストは data URL とモックのみで外部通信しない。新しい起動時通信・子プロセス・動的実行はない。実出力で予算を減らし、申告した展開サイズは確保に使わない。既存の ZIP オフセット読取は Buffer の境界検査に従い、今回の修正では別の形式検証へ範囲を広げていない。

## 受け入れ条件

- C-1 unzip(buf, limits): 展開結果は各エントリ512 MiB以内・合計1 GiB以内で、境界値を受理し超過を拒否する
- C-2 readZipResponse(res): Content-Lengthと逐次受信量の双方で80 MiB超過を打ち切り、正常なZIPと既存エラー経路を維持する

## 検証結果

`npm --workspace apps/server run test -- src/lib/unzip.test.ts src/lib/gtfs-import.test.ts` は 2 ファイル、17 テスト成功。stored/deflate の境界と超過、残り合計予算、重複名、申告サイズ偽装、ZIP64/暗号化/未対応方式の拒否、受信超過とキャンセル、80 MiB ちょうどの正常 ZIP、reader 解放、既存エラー経路を確認した。

Augur 契約 lint は問題 0 件、契約観測は 2 件とも covered・違反 0 件。Anatomia verify は全 gate 成功。git diff --check は成功。サービス起動・ビルド・他テストは依頼範囲外のため未実施。

仕様: spec/feature/gtfs-zip-limits.md。テスト計画: spec/test/gtfs-zip-limits.plan.json。関連タスク: actio:8013d704-2a5b-4fa2-812f-4bce47b0b998。
