# マージ後に古いWeb成果物が配信された

- Date: 2026-08-25
- Status: mitigated; recurrence prevention pending
- Area: Web配信 / 運用反映
- Severity: ユーザーがマージ済みUIを利用できない

## Summary

移動経路の確定情報UIを含む変更をマージし、Peregrinatioを再起動した後も、ユーザーから「経路が変わっていない」と報告された。これはマージ済みソースと実際に配信されるWeb成果物が一致しない反映漏れである。

## Evidence

- 2026-08-25T13:53:28+09:00 時点の本体 `main` はマージコミット `bd170332459c7dd7a32cc1fdf6c9590d2eea5bf5`。
- `apps/server/src/index.ts` は `apps/web/dist` を静的配信する。
- ファイルと `http://127.0.0.1:8090/build-meta.json` はともに `built_at: 2026-08-20T14:52:58.035Z` を返した。
- 配信bundleに今回追加した「確定情報」「タクシー」は含まれていなかった。
- Excubitorのサービス定義は `npm run dev:server` であり、Web buildは実行しない。

## Regression Context

Webソースを変更したPRの反映確認で、サーバープロセスの再起動とhealth 200だけを確認し、静的成果物のbuild日時と内容を確認しなかった。

## Cause

サーバー再起動だけでは `apps/web/dist` が再生成されない。マージ後に本体フォルダで `npm run build:web` が実行されなかったため、古いbundleが継続配信された。

## Fix Requirements

- Peregrinatio本体フォルダでWeb成果物をbuildする。
- 配信中の `build-meta.json` が新しいbuild日時へ変わることを確認する。
- 配信bundleが「確定情報」「タクシー」を含むことを確認する。
- 不要なプロセス再起動を行わない。

## Verification

単体・統合テストはユーザー指示がないため実行していない。Peregrinatio本体フォルダで `npm run build:web` が成功し、次を確認した。

- 配信 `build-meta.json`: `built_at: 2026-08-25T04:54:33.819Z`
- 配信JS: `/assets/index-BlL2D2xF.js`
- 配信JSに「確定情報」「タクシー」が存在
- ルートHTTP status: 200
- サービス状態: running / health 200
- Excubitor instance IDはbuild前後で同一であり、再起動していない

## Follow-up

Web変更を反映する運用では、再起動の前に静的配信かdev配信かを確認し、静的配信ならWeb buildを必須にする。
今回の配信は手動buildで復旧したが、Web変更のマージ後にbuildを保証する仕組みは未実装である。
