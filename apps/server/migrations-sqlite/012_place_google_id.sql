-- 地図上の POI (Google Places) から追加した場所の重複防止用に Google の place id を保持する。
-- 同じ POI を再タップしても新規作成せず既存の場所を再利用する (from-google ルート)。
ALTER TABLE places ADD COLUMN google_place_id TEXT;

CREATE INDEX IF NOT EXISTS idx_places_google_place_id ON places(google_place_id);
