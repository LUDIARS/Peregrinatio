# LLM / vision (claude CLI バックエンド)

LUDIARS 規約により Anthropic API は使わず、既ログインの **claude Code CLI** (`claude -p`) を
LLM バックエンドにする ([[feedback_ludiars_no_api_use_claude_cli]])。実装は `@peregrinatio/llm`。

## テキスト補完 (`complete`)

`packages/llm/src/complete.ts`。`claude -p --model <m>` を spawn し、プロンプトは **stdin** で渡す
(Windows の引数長制限 ENAMETOOLONG 回避)。`system` があれば `user` の前に結合して 1 本の stdin にする。
施設サマリーの構造化抽出 (`@peregrinatio/crawl` の `extractPlaceInfo`) が利用する。

## 画像解析 (`analyzeImage`)

`packages/llm/src/vision.ts`。claude CLI には画像を直接渡すフラグが **無い**。そこで print mode で
**Read ツールを許可** し、画像の **絶対パス** をプロンプト内で参照させて読み取らせる方式を採る。

```
claude -p --model <m> --allowedTools Read --add-dir <画像のディレクトリ>
  (stdin) 「次の画像ファイルを Read ツールで開いて … <絶対パス> … <指示>」
```

- `--allowedTools Read` … print mode で Read を自動許可 (permission プロンプトを出さない)。
- `--add-dir <dir>` … cwd 外 (uploads 配下など) のファイルへ Read のアクセスを許可する。
- プロンプトに **絶対パス** を明記し、Read で開かせる。

### 検証結果 (動いた)

`claude 2.1.191` / `--model haiku` で、テキスト入りの PNG を Read させ、
`{"analysis": "...", "address": "..."}` 形式で画像内テキストと住所を抽出できることを実機確認した。
すなわち「headless で画像入力不可」ではなく、**絶対パス + Read ツール許可** で vision が成立する。

### 限界 / 注意

- 画像が **ローカルファイルとして存在** している必要がある (URL 直渡しは不可)。
  本サービスでは composite 画像が `apps/server/uploads/...` に保存済みのため問題ない。
- claude CLI が **ログイン済み** であること (未ログイン/未インストールは非 0 終了で例外 surface。
  silent fallback はしない [[feedback_no_silent_fallback]])。
- Windows では claude CLI が git-bash を要求する場合がある。その際は server プロセスの env に
  `CLAUDE_CODE_GIT_BASH_PATH` を設定する ([[feedback_claude_cli_windows_bash]])。
- レイテンシは Read ツールの 1 往復ぶん上乗せされる (数十秒規模)。`runClaudeCli` の `timeoutMs`
  既定は 120s。

## モデル設定

`apps/server/src/config.ts` の `config.llm.{summaryModel, visionModel}`。エイリアス
(`haiku`/`sonnet`/`opus`) でもフルモデル ID (`claude-haiku-4-5-20251001`) でも `--model` に渡せる
(両方とも実機確認済み)。既定は haiku。
