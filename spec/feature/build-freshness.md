# ビルド鮮度 (古い PWA ビルドの自動更新)

## 目的

iOS ホーム画面に追加した PWA が、Service Worker やブラウザキャッシュに残った古いビルドを
表示し続ける問題を防ぐ。利用者が手動でキャッシュを消さなくても、次回起動時に最新ビルドへ
切り替わる状態にする。

## ビルド識別子

- ビルド版数は `git rev-parse --short=12 HEAD` (作業ツリーが汚れていれば `-dirty` 付き)。
  git を参照できない環境では `unknown-<timestamp>` にフォールバックする。
- 環境変数 `PE_BUILD_VERSION` があればそれを優先する。
- 版数とビルド時刻は、次の 2 か所へ**同一の値**で埋め込む。
  - クライアントバンドル (`__PE_BUILD_VERSION__` / `__PE_BUILD_BUILT_AT__` の define)
  - 配信物 `dist/build-meta.json` (`{ version, built_at }`)
- `build-meta.json` は Service Worker のプリキャッシュ対象から除外する
  (プリキャッシュすると古い版数を返し、更新検知が働かなくなるため)。

## 振る舞い

- 起動時 (`load` 後、既に `complete` なら即時) に `GET /build-meta.json` を
  `cache: no-store` で取得する。
- 取得した `version` が埋め込み版数と同じ、または取得に失敗した場合は何もしない。
  同じ場合のみ現在の版数を `localStorage` (`pe:build-version` / `pe:build-built-at`) に記録する。
- 異なる場合は次を順に行う。
  1. `sessionStorage` の `pe:build-reload:<version>` を確認し、既にリロード済みなら中断する。
  2. 同キーへ印を書き込む。**書き込めない場合はリロードしない** (印を残せないまま古い
     Service Worker が旧 JS を返し続けると無限リロードになるため)。
  3. `pe-` / `workbox-precache` で始まる Cache Storage を削除し、Service Worker を update する。
  4. `?_pe_build=<version>` を付けて `location.replace` する。
- キャッシュ削除と Service Worker update は best-effort とし、失敗してもリロードは実行する。
- 更新確認の失敗はアプリの動作に影響させない (例外を握り、通常描画を継続する)。

## サーバ側の配信

- `GET /build-meta.json` は `apps/web/dist/build-meta.json` を `no-store` で返す。
  未ビルド/読み取り失敗時は `503` + `{ version: 'unknown', built_at: null }`。
- `GET /` と SPA フォールバックの `index.html` も `no-store` で返す。
  ハッシュ付きの JS/CSS は従来どおり静的配信の既定に任せる。

## 制約・既知の制限

- 更新検知は起動時のみ。起動しっぱなしのタブは次回起動まで古いビルドのままになる。
- `build-meta.json` は未認証で取得でき、コミットの短縮ハッシュとビルド時刻を公開する。
- dev (vite:5179) では `build-meta.json` が存在しないため、更新検知は事実上無効になる。

## 関連

- 実装: `apps/web/vite.config.ts` / `apps/web/src/lib/build-version.ts` / `apps/server/src/index.ts`
- API: [`../interface/api.md`](../interface/api.md) の `GET /build-meta.json`
