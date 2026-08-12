---
task: local-pr-346-rereview
project: Peregrinatio
kind: レビュー
created: 2026-08-11
memory_links: []
---
# Revisor local PR #346 の再審査経路を確定する

## 目的

local PR #346 (`feat/service-version-ui`) は
`Test autofix changed the review plan and the newly selected registered tests do not pass.`
で審査失敗のまま止まっている。原因側の対策は
[2026-08-11-service-version-ui.md](2026-08-11-service-version-ui.md) の `6531755` で入れたが、
**再審査をどう回すかは人間判断が要る**ため、ここに残作業として切り出す。

### 調査で判明していること

- この文言は Revisor `src/runner.mjs` の `verifyAutofixPlan()` が投げる例外。
  登録テスト失敗 → autofix が修正 → autofix が変更種別 (change kinds) を変えた →
  review plan を再計画して登録テストを選び直し → それが落ちて throw、という経路。
- throw は `buildGateResult()` より前で起きるため、**#346 に CI 証拠が残っていない**
  (`ci: []`)。どの登録テストが落ちたのかは Revisor 側からは特定できない。
- `commitAndAdvanceAutofix()` は審査の最後にしか走らないので、
  **autofix の変更はブランチに一切入っていない**。ブランチは作者が出した内容のまま。
- 環境自体は健全: 同じ登録テスト (install / test / build) は後続の
  Peregrinatio local PR #408 (2026-08-10) で全て passed。
- `6531755` の狙いは throw 経路の回避 (提出時点で変更種別に test を含めておけば
  autofix がテストを触っても change kinds が変わらず再計画に入らない) であって、
  「元々どの登録テストが落ちたか」の根治ではない。

## 完了条件

- 次のいずれかが人間の判断で選ばれ、実行されている。
  - a. #346 の retry として再審査を回す (`headSha` は `f947f38` のままで `6531755` を指していない)。
  - b. 新しい local PR として出し直す。
- 再審査の結果、登録テスト `install` / `test` / `build` が全て passed になっている。
- 再び失敗した場合は、今回は CI 証拠が残るので、その出力に沿って原因を修正する。

## スコープ (編集可ディレクトリ)

- apps/web/ (再審査で失敗が判明した場合の修正)
- spec/tasks/ (この md)

## 判断待ちの点

- 上記 a / b の選択。GitHub は使わない・push / merge / auto-merge はしない方針のため、
  セッション側からの再提出は行っていない。
