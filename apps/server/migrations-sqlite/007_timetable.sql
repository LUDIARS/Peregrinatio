-- 時刻表 / 運行情報。データ源 (NAVITIME/駅すぱあと/ODPT 等) は未配線のため、
-- まずは手入力で end-to-end 動く骨組みとしてテーブルだけ用意する。
-- fetch プロバイダを後段で差し込めば同テーブルへ流し込める設計。

-- 時刻表ボード = 区間 (from→to) の保存単位。kind: 'shinkansen' | 'bus' | 'train'。
CREATE TABLE IF NOT EXISTS timetables (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'train',
  line_name    TEXT,
  from_station TEXT,
  to_station   TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timetables_trip ON timetables(trip_id);

-- 便 (1 本の列車/バス)。depart_time/arrive_time は 'HH:MM'。
CREATE TABLE IF NOT EXISTS timetable_departures (
  id           TEXT PRIMARY KEY,
  timetable_id TEXT NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  depart_time  TEXT,
  arrive_time  TEXT,
  train_name   TEXT,
  platform     TEXT,
  fare_text    TEXT,
  note         TEXT,
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timetable_departures_tt ON timetable_departures(timetable_id);

-- 運行情報 (遅延/運休など)。severity: 'normal' | 'info' | 'warning' | 'suspended' 等。
CREATE TABLE IF NOT EXISTS service_alerts (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  line_name  TEXT,
  severity   TEXT NOT NULL DEFAULT 'info',
  title      TEXT,
  body       TEXT,
  source_url TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_alerts_trip ON service_alerts(trip_id);
