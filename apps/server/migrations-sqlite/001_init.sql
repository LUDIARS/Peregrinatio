-- Peregrinatio 初期スキーマ (spec/data/schema.md)

CREATE TABLE IF NOT EXISTS trips (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  start_date       TEXT,
  end_date         TEXT,
  cover_image_path TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trip_days (
  id        TEXT PRIMARY KEY,
  trip_id   TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL,
  date      TEXT,
  title     TEXT,
  notes     TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_days_trip ON trip_days(trip_id);

CREATE TABLE IF NOT EXISTS places (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        REAL,
  lng        REAL,
  category   TEXT,
  source_url TEXT,
  summary    TEXT,
  notes      TEXT,
  pinned     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_trip ON places(trip_id);

CREATE TABLE IF NOT EXISTS place_images (
  id          TEXT PRIMARY KEY,
  place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_place_images_place ON place_images(place_id);

CREATE TABLE IF NOT EXISTS image_analyses (
  id                 TEXT PRIMARY KEY,
  place_id           TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  composite_image_id TEXT REFERENCES place_images(id) ON DELETE SET NULL,
  analysis_text      TEXT,
  extracted_address  TEXT,
  extracted_lat      REAL,
  extracted_lng      REAL,
  model              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_image_analyses_place ON image_analyses(place_id);

CREATE TABLE IF NOT EXISTS itinerary_items (
  id           TEXT PRIMARY KEY,
  day_id       TEXT NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
  place_id     TEXT REFERENCES places(id) ON DELETE SET NULL,
  order_index  INTEGER NOT NULL,
  planned_time TEXT,
  kind         TEXT NOT NULL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_itinerary_items_day ON itinerary_items(day_id);

CREATE TABLE IF NOT EXISTS route_legs (
  id            TEXT PRIMARY KEY,
  day_id        TEXT NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
  from_place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
  to_place_id   TEXT REFERENCES places(id) ON DELETE SET NULL,
  mode          TEXT NOT NULL,
  duration_sec  INTEGER,
  distance_m    INTEGER,
  fare_text     TEXT,
  polyline      TEXT,
  raw_json      TEXT,
  computed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_route_legs_day ON route_legs(day_id);

CREATE TABLE IF NOT EXISTS geocode_cache (
  location    TEXT PRIMARY KEY,
  lat         REAL,
  lng         REAL,
  ok          INTEGER,
  geocoded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
