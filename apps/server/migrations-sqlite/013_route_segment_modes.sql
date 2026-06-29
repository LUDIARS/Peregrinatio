-- 区間 (place→place / 出発地点→place) ごとに、ユーザが選んだ移動手段を永続化する。
-- route_legs は予定の並べ替えで毎回作り直されるため、区間の手段を route_legs に持たせると
-- 並べ替えで失われる。場所ペア (from_key/to_key) をキーに保存し、再計算時に復元する。
-- from_key/to_key = place_id、出発/帰着地点 (origin) は '@origin'。
-- これにより各区間は別々に管理され、ある区間の変更が他区間に連動しない (完全独立)。
CREATE TABLE IF NOT EXISTS route_segment_modes (
  id         TEXT PRIMARY KEY,
  day_id     TEXT NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
  from_key   TEXT NOT NULL,
  to_key     TEXT NOT NULL,
  mode       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(day_id, from_key, to_key)
);

CREATE INDEX IF NOT EXISTS idx_route_segment_modes_day ON route_segment_modes(day_id);
