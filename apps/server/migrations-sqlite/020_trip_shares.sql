CREATE TABLE trip_shares (
  trip_id       TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
