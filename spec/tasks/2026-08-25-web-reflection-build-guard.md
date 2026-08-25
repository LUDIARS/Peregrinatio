---
task: web-reflection-build-guard
project: Peregrinatio
kind: 実装
created: 2026-08-25
memory_links:
  - spec/plan/problem_logs/2026-08-25-stale-web-build-after-merge.md
---
# Web反映時に静的成果物の更新を保証する

## 目的

Peregrinatioはサーバーが `apps/web/dist` を配信する一方、Excubitorの起動コマンドは
`npm run dev:server` のため、Webソースをマージしてサーバーを再起動しただけでは古い成果物が
配信され続ける。反映工程でソースと配信成果物の不一致を検出し、必要なWeb buildを確実に
実行できるようにする。

## 完了条件

- `apps/web` の変更を反映するとき、Peregrinatio本体フォルダでWeb buildが実行される。
- `build-meta.json` の `version` を期待するソース識別子と照合し、`unknown-*`、`-dirty`、
  または不一致を検証不能・不一致として失敗にできる。`built_at` は診断情報として扱い、
  日時だけで成功判定しない。
- build後に配信中のHTMLが参照するハッシュ付きJSを取得し、対応する
  `apps/web/dist` 内のJSと内容のダイジェストが一致することを機械的に判定できる。
- 静的成果物の更新だけで足りる場合は、Peregrinatioプロセスを不要に再起動しない。
- build失敗や成果物不一致をhealth 200だけで成功扱いにせず、明示的な失敗として報告する。
- 反映判定と失敗経路を検証する登録テストを追加する。

## スコープ（編集可能ディレクトリ）

- `scripts/`
- `apps/web/`
- `package.json`
- `excubitor.catalog.yaml`
- `spec/`
