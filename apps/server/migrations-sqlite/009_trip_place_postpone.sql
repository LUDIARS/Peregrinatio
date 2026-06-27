-- 「また今度」フラグ。場所(ライブラリ)ではなく旅ごとのメンバーシップ(trip_places)に持つ。
-- これにより、ある旅で「また今度」にした場所も別の旅では通常表示になる。
ALTER TABLE trip_places ADD COLUMN postponed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_trip_places_postponed ON trip_places(trip_id, postponed);
