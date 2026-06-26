# test/ — テスト

テスト設計。種別 (ビルドチェック/ユニット/smoke/統合/E2E) ごとに「何を担保するか」、
対象・実行方法・CI での扱い・現状・やることを書く。方針は RULE_TEST.md。

- [server-integration.md](./server-integration.md) — API ルートの統合テスト (実 SQLite migration 上で `app.request()`)。
- ユニット: `packages/crawl`(extract/robots)、`packages/llm`(json) に併設の `*.test.ts`。
- CI: `.github/workflows/ci.yml` が PR / main push で全 workspace の build + test を実行。
