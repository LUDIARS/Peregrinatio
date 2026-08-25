# 移動経路の確定情報

## 目的

自動検索した経路候補とは別に、予約・時刻表確認後の確定情報を旅程の区間へ登録する。
確定情報は場所の並べ替えに伴う `route_legs` 再生成後も区間 override から復元する。

## 振る舞い

- `SPEC-FIXED-ROUTE-SAVE`: 各移動区間から「確定情報」を開き、移動手段、出発時刻、到着時刻、メモを保存できる。
- 公共交通は `新幹線 / 電車 / バス / 飛行機 / タクシー` を選択する。
- 保存済み区間には「確定済み」を表示する。確定状態だけ解除することもできる。
- `SPEC-FIXED-ROUTE-URLS`: メモ内の `http://` / `https://` URL は、Web と PDF でクリック可能なリンクとして表示する。
- URL 以外のメモ文字列はプレーンテキストとして扱い、HTML を解釈しない。

## 永続化

- `SPEC-FIXED-ROUTE-PERSISTENCE`

`route_legs` は現在表示する値、`route_segment_modes` は並べ替え後も残る値を持つ。
両方の更新は同一トランザクションで行う。

- `transit_kind`: `shinkansen | train | bus | airplane | taxi | null`
- `is_fixed`: `0 | 1`
- `depart_time` / `arrive_time`: `HH:MM | null`
- `note`: URLを含められるテキスト

関連: [`../data/schema.md`](../data/schema.md)、[`../interface/api.md`](../interface/api.md)
