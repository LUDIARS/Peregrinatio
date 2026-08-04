# Google Places Photo URI の永続参照切れ

- Date: 2026-08-03
- Status: unresolved
- Area: place representative images / Google Places Photo integration
- Severity: partial display failure

## Summary

代表画像の参照切れを確認した。これは回帰として扱う。Google Places Photo の短命な `photoUri` を `places.image_url` に永続保存しており、失効後に画面上の画像が表示できなくなる。

## Evidence

- 調査時点の SQLite では `places.image_url` 84 件がすべて `lh3.googleusercontent.com` の外部 URL だった。
- 同じ URL に画像取得リクエストを行った結果、40 件は画像として取得でき、44 件は `403 text/html` だった。
- ローカルアップロード画像は `place_images` 4 件すべてが実ファイルと一致しており、ローカル参照切れは 0 件だった。
- `packages/places/src/index.ts` の `resolvePhotoUrl()` は Places Photo media API の `photoUri` を返し、`apps/server/src/routes/autosearch.ts`、`recommend.ts`、`place-media.ts`、`crawl.ts` がその値を `places.image_url` に保存している。
- Google Places API は `photoUri` を短命 URI と定義し、写真 URI および写真名をキャッシュしないよう求めている。

## Regression Context

アプリは `assetUrl()` で外部 HTTP URL をそのまま画像要素へ渡すため、保存済み URI が失効すると全表示箇所（場所詳細、旅一覧、行程、ライブラリ）で同じ壊れた参照を再利用する。

## Cause

短命でキャッシュ不可の Google Places Photo `photoUri` を恒久的な画像 URL として DB に保存している。URI の失効により Google が `403` を返し、クライアントには代替表示や再取得経路がない。

## Fix Requirements

- Google の短命 `photoUri` を `places.image_url` に永続保存しない。
- 表示時に Google Places から新しい写真情報を取得し、一時 URI を解決する経路を設ける。Google のキャッシュ制約と必要な attribution を満たすこと。
- 既存の Google `lh3.googleusercontent.com` 保存値を再取得可能な状態へ移行し、失効 URI を再利用しない。
- 外部画像の取得失敗を観測可能にし、壊れた画像アイコンだけを表示する状態を避ける。

## Verification

- 失効済み URI と有効な URI を含む fixture で、表示時に有効な写真 URI を解決することを確認する。
- 期限切れ URI が `403` を返す場合に、画面が代替表示または再取得結果を表示することを確認する。
- ローカル `/uploads/...` の画像参照が従来どおり配信されることを確認する。

## Follow-up

- 修正後、既存の 84 件を一括再取得せず、Google の利用規約に沿って必要時に新しい写真情報を取得する移行方法を決める。
