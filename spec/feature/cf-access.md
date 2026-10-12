# Cloudflare Access による入口の鍵

## 目的

公開入口 (`pe.ai-run-do.com`、LOCAL Tunnel → 127.0.0.1:8091) を Cloudflare Access で許可した人だけに絞る。

## 構成

- Cloudflare 側: Access アプリ (domain = 公開ホスト) + 許可ポリシー、Tunnel route は `originRequest.access.required=true`
  (エッジで JWT 必須)。作業は Excubitor の CF ブローカー経由で行う (アプリのコード外)。
- アプリ側 (多重防御): ループバック以外から来た要求は `Cf-Access-Jwt-Assertion` を検証する。
  - team domain / AUD は Excubitor の runtime-config (`EXCUBITOR_SERVICE_CONFIG_JSON.cloudflareAccess.{teamDomain,audience}`) から受ける。
  - 検証: RS256、`https://<team>/cdn-cgi/access/certs` の JWK (kid 一致、キャッシュ 10 分、kid 不一致時のみ再取得)、`aud` 含有、`exp` / `nbf`、`iss` = `https://<team>`。
  - 失敗は 403 (本文に理由コードのみ)。`Cf-Access-Authenticated-User-Email` は署名が無いので使わない。
  - runtime-config に cloudflareAccess が無いときは検証しない (直接アクセス・開発用)。起動ログに「Access 検証: 無効」を出す。
  - サーバは 127.0.0.1 にしか bind しないので、Tunnel 以外の外部経路は無い。Ex Viewer 経由 (ループバック) は Ex の認可に従う。
- 実装は Elegantia `src/runtime/cf-{jwt,access}.ts` と同じく依存なし (node:crypto)。`apps/server/src/security/` に置く。

## 共有リンク

neco の判断 (2026-10-12): **本人だけ (ALLOW ME)、共有リンク (`/s/:token`) も鍵の内側**。
アプリ側に検証除外パスは設けない。将来鍵の外に出す場合は、Access のパス別 bypass アプリと、アプリ側の検証除外パスを
同じ一覧で管理する (片方だけ外すと、エッジかアプリのどちらかで 403 になる)。

## 実装 (2026-10-13)

- `apps/server/src/security/`: `cf-jwt.ts` (JWS 分解・RS256)、`cf-access-verifier.ts` (JWKS キャッシュ・claims)、
  `cf-access-config.ts` (runtime-config)、`request-origin.ts` (ループバック判定)、`cf-access-middleware.ts`。
  `buildApiApp({ cfAccess })` が全パスの先頭 (requestLogger の直後) に噛ませ、index.ts が後から足す静的配信も対象になる。
- ループバックの定義: サーバは 127.0.0.1 bind で cloudflared もローカルから繋ぐため、送信元ソケットだけでは区別できない。
  **送信元がループバック かつ Host がループバック名 (127.0.0.1 / localhost / [::1]) かつ `cf-connecting-ip` / `cf-ray` /
  `cf-access-jwt-assertion` が無い** 要求だけを通し、それ以外 (公開ホスト名・CF ヘッダ付き) はすべて検証する。
- 403 の理由コード: `missing_assertion` / `malformed_token` / `unsupported_alg` / `unknown_kid` / `bad_signature` /
  `bad_issuer` / `bad_audience` / `expired` / `not_yet_valid`。
- JWKS は 10 分キャッシュ。kid が見つからないときだけ取り直す (1 分に 1 回まで)。取得失敗は手持ちの鍵で続け、
  鍵が無ければ `unknown_kid` (閉じる側に倒れる)。
- runtime-config の形: `{ "cloudflareAccess": { "teamDomain": "https://<team>.cloudflareaccess.com", "audience": "<AUD>" } }`。
  `<team>.cloudflareaccess.com` だけでも https を補う。片方だけ・AUD が 16 進でない・JSON でない場合は起動を止める。

## 条項

- `SPEC-CF-ACCESS-CONFIG`: team domain / AUD は Excubitor の runtime-config から受け、無ければ検証しない (起動ログに「Access 検証: 無効」)。片方だけ・不正値は起動を止める。
- `SPEC-CF-ACCESS-VERIFY`: Cf-Access-Jwt-Assertion を RS256・JWKS (10 分キャッシュ、kid 不一致時のみ再取得)・aud / exp / nbf / iss で検証し、失敗は 403 + 理由コード。
- `SPEC-CF-ACCESS-LOOPBACK`: ループバックからの要求 (Ex Viewer・ヘルスチェック) は通し、それ以外 (Tunnel 経由) は共有リンクも含めて検証する。

## ファイルと役割

| ファイル | 役割 | 条項 |
|---|---|---|
| `apps/server/src/security/cf-access-config.ts` | runtime-config の読み込み (半端な設定は起動を止める) | SPEC-CF-ACCESS-CONFIG |
| `apps/server/src/index.ts` | 検証器を作り、起動ログに有効 / 無効を出す | SPEC-CF-ACCESS-CONFIG |
| `apps/server/src/security/cf-jwt.ts` | JWS の分解と RS256 | SPEC-CF-ACCESS-VERIFY |
| `apps/server/src/security/cf-access-verifier.ts` | JWKS キャッシュと claims の検証 | SPEC-CF-ACCESS-VERIFY |
| `apps/server/src/security/request-origin.ts` | ループバック判定 | SPEC-CF-ACCESS-LOOPBACK |
| `apps/server/src/security/cf-access-middleware.ts` | 全パスの先頭で検証する Hono ミドルウェア | SPEC-CF-ACCESS-VERIFY / LOOPBACK |
| `apps/server/src/app.ts` | `buildApiApp({ cfAccess })` で噛ませる | SPEC-CF-ACCESS-VERIFY |
