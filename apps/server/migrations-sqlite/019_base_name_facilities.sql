ALTER TABLE trip_places ADD COLUMN base_name TEXT;
ALTER TABLE trip_places ADD COLUMN base_name_source TEXT;

CREATE TABLE place_facilities (
  id          TEXT PRIMARY KEY,
  place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'haiku',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (place_id, name),
  UNIQUE (id, place_id)
);

CREATE TABLE trip_place_facility_wants (
  trip_id     TEXT NOT NULL,
  place_id    TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trip_id, place_id, facility_id),
  FOREIGN KEY (trip_id, place_id) REFERENCES trip_places(trip_id, place_id) ON DELETE CASCADE,
  FOREIGN KEY (facility_id, place_id) REFERENCES place_facilities(id, place_id) ON DELETE CASCADE
);

CREATE INDEX idx_place_facilities_place
  ON place_facilities(place_id, order_index);
