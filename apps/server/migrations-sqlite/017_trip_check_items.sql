CREATE TABLE IF NOT EXISTS trip_check_items (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  list_type   TEXT NOT NULL CHECK (list_type IN ('packing', 'todo')),
  title       TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  quantity    INTEGER,
  category    TEXT,
  due_at      TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trip_check_items_trip_type
  ON trip_check_items(trip_id, list_type, status, order_index);
