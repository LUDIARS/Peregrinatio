-- 場所を「全旅で共有の恒久ライブラリ」に作り替える。
--  - places から trip 所有 (trip_id/cascade) と trip 固有フラグ (is_base/pinned) を除去。
--  - 旅↔場所は trip_places (メンバーシップ, is_base は旅ごと) で結ぶ。
--  - status (気になる/訪問済み/なし) を追加。
-- これにより旅を削除/アーカイブしても場所は残る。
-- ※ FK 参照の張り替えのため runMigrations() は foreign_keys=OFF の状態でこの SQL を流す。

CREATE TABLE places_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        REAL,
  lng        REAL,
  category   TEXT,
  source_url TEXT,
  summary    TEXT,
  notes      TEXT,
  image_url  TEXT,
  status     TEXT NOT NULL DEFAULT 'none',  -- 'interested' | 'visited' | 'none'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO places_new (id, name, address, lat, lng, category, source_url, summary, notes, image_url, status, created_at, updated_at)
  SELECT id, name, address, lat, lng, category, source_url, summary, notes, image_url, 'none', created_at, updated_at FROM places;

CREATE TABLE trip_places (
  trip_id  TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places_new(id) ON DELETE CASCADE,
  is_base  INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trip_id, place_id)
);

INSERT OR IGNORE INTO trip_places (trip_id, place_id, is_base, added_at)
  SELECT trip_id, id, is_base, created_at FROM places WHERE trip_id IS NOT NULL;

DROP TABLE places;
ALTER TABLE places_new RENAME TO places;

CREATE INDEX IF NOT EXISTS idx_places_status ON places(status);
CREATE INDEX IF NOT EXISTS idx_trip_places_trip ON trip_places(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_places_place ON trip_places(place_id);
