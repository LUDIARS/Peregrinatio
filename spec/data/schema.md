# データモデル (spec/data)

SQLite 既定 (Postgres 切替可)。型は SQLite 表記で記す。Postgres 化時は TEXT→TEXT/UUID,
INTEGER bool→BOOLEAN, REAL→DOUBLE PRECISION, ISO 文字列日時→TIMESTAMPTZ に読み替える。
id は UUID 文字列 (アプリ生成)。日時は ISO8601 文字列で保存する。

## trips — 旅 (= しおり 1 冊)
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| title | TEXT NOT NULL | |
| start_date | TEXT | YYYY-MM-DD |
| end_date | TEXT | YYYY-MM-DD |
| cover_image_path | TEXT | |
| notes | TEXT | |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

## trip_days — 旅の各日
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| trip_id | TEXT NOT NULL FK trips(id) | |
| day_index | INTEGER NOT NULL | 0 始まり |
| date | TEXT | YYYY-MM-DD |
| title | TEXT | |
| notes | TEXT | |

## places — 気になる場所 / 施設 (= 地図ピン)
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| trip_id | TEXT NOT NULL FK trips(id) | |
| name | TEXT NOT NULL | |
| address | TEXT | |
| lat | REAL | NULL なら未ジオコーディング |
| lng | REAL | |
| category | TEXT | |
| source_url | TEXT | クロール元 |
| summary | TEXT | クロール/解析の要約 |
| notes | TEXT | |
| pinned | INTEGER NOT NULL DEFAULT 1 | 0/1 |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

地図ピンは `places` で lat/lng を持つ行で表現する (専用 pins テーブルは作らない)。

## place_images — 場所に紐づく画像
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| place_id | TEXT NOT NULL FK places(id) | |
| kind | TEXT NOT NULL | 'source' | 'composite' |
| path | TEXT NOT NULL | server 内相対パス (uploads/...) |
| order_index | INTEGER NOT NULL DEFAULT 0 | source の連番 |
| width | INTEGER | |
| height | INTEGER | |
| created_at | TEXT NOT NULL | |

Kindle 連番画像は kind='source' (order_index=連番) で受け、右→左連結した 1 枚を
kind='composite' で保存する。

## image_analyses — 「画像を解析」結果
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| place_id | TEXT NOT NULL FK places(id) | |
| composite_image_id | TEXT FK place_images(id) | 解析対象 |
| analysis_text | TEXT | LLM の読み取り結果 |
| extracted_address | TEXT | |
| extracted_lat | REAL | |
| extracted_lng | REAL | |
| model | TEXT | 使用モデル/backend |
| created_at | TEXT NOT NULL | |

## itinerary_items — 日ごとの行動予定
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| day_id | TEXT NOT NULL FK trip_days(id) | |
| place_id | TEXT FK places(id) | NULL 可 (メモ行) |
| order_index | INTEGER NOT NULL | |
| planned_time | TEXT | HH:MM |
| kind | TEXT NOT NULL | 'visit' | 'move' | 'note' |
| note | TEXT | |

## route_legs — 予定間の経路
| col | type | 備考 |
|---|---|---|
| id | TEXT PK | |
| day_id | TEXT NOT NULL FK trip_days(id) | |
| from_place_id | TEXT FK places(id) | |
| to_place_id | TEXT FK places(id) | |
| mode | TEXT NOT NULL | 'driving' | 'walking' | 'transit' | 'bicycling' |
| duration_sec | INTEGER | |
| distance_m | INTEGER | |
| fare_text | TEXT | |
| polyline | TEXT | encoded polyline |
| raw_json | TEXT | API 生レスポンス |
| computed_at | TEXT NOT NULL | |

## geocode_cache — ジオコーディングキャッシュ (Tr 踏襲)
| col | type | 備考 |
|---|---|---|
| location | TEXT PK | 入力住所文字列 |
| lat | REAL | |
| lng | REAL | |
| ok | INTEGER | 0/1 失敗も記録し再試行抑制 |
| geocoded_at | TEXT | |
