# spec/

このリポジトリの設計仕様。FORMAT_SPEC.md の 6 分類で管理する
(`plan/` は実装の都度作る作業ドキュメントなので雛形には含めない)。

- [data/](./data/) — データスキーマ
- [feature/](./feature/) — 機能概要 (1 機能 1 ファイル)
- [interface/](./interface/) — API・外部連携の contract
- [setup/](./setup/) — セットアップ
- [test/](./test/) — テスト設計

> spec/ 直下に分類外のドキュメントを置かない。非正規フォルダ (`usage/` 等) を作らない。
> 構造は `check-spec-structure.mjs` が CI で検査する。
