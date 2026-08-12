---
task: service-version-ui
project: Peregrinatio
kind: 実装
created: 2026-08-11
memory_links: []
---
# Web UI に稼働中のランタイム版数を表示する

## 目的

どの版が端末で動いているのかを画面から判別できるようにする。PWA は Service Worker と
ブラウザキャッシュで古い JS を掴んだままになることがあり、「修正が反映されない」報告の
切り分けに、稼働中ビルドの版数が画面上で読める必要がある。

版数の正本は Excubitor が各サービスへ配る `EXCUBITOR_SERVICE_VERSION` とし、
既存の `PE_BUILD_VERSION` と git ハッシュはローカル開発用のフォールバックとして残す。

## 完了条件

- `apps/web/vite.config.ts` の `BUILD_VERSION` が
  `EXCUBITOR_SERVICE_VERSION` → `PE_BUILD_VERSION` → git ハッシュの順に解決する。
- `apps/web/src/lib/build-version.ts` がビルド時に解決した版数を
  `currentBuildVersion` として公開する。
- `App` のヘッダ (ブランドロゴ横) に `v<版数>` が `.brand-version` として表示される。
- 上記が vitest で検証されている (版数が非空であること / ヘッダに描画されること)。
- 登録テスト `install` / `test` / `build` が Revisor の審査で通る。

## スコープ (編集可ディレクトリ)

- apps/web/ (vite.config.ts, src/App.tsx, src/lib/build-version.ts, src/styles.css, src/App.test.tsx)
- spec/tasks/ (この md)

## 状況 (2026-08-11)

ブランチ `feat/service-version-ui` に実装済み。

- `f947f38` 実装本体 (4 ファイル)
- `6531755` 登録テスト向けのカバレッジ追加 (`apps/web/src/App.test.tsx`)

Revisor local PR #346 として提出済みだが審査は未通過。詳細は
[2026-08-11-local-pr-346-rereview.md](2026-08-11-local-pr-346-rereview.md)。
