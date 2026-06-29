-- GTFS / GTFS-JP (バス・一部鉄道) の時刻表データを一括取込して保持する。
-- フィード(事業者)単位で取り込み、再取込はフィード単位で入れ替える。
-- 近くの停留所→発車時刻ボードを引くのに使う (route_type で鉄道/バス判別)。

CREATE TABLE IF NOT EXISTS gtfs_feeds (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,        -- 表示名 (事業者名など)
  source_url  TEXT,                 -- 取得元 URL
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  stop_count  INTEGER NOT NULL DEFAULT 0,
  trip_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gtfs_stops (
  feed_id   TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  stop_id   TEXT NOT NULL,
  stop_name TEXT,
  lat       REAL,
  lng       REAL,
  PRIMARY KEY (feed_id, stop_id)
);

CREATE TABLE IF NOT EXISTS gtfs_routes (
  feed_id    TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  route_id   TEXT NOT NULL,
  short_name TEXT,
  long_name  TEXT,
  route_type INTEGER,               -- 0/1/2=鉄道系, 3=バス (GTFS route_type)
  PRIMARY KEY (feed_id, route_id)
);

CREATE TABLE IF NOT EXISTS gtfs_trips (
  feed_id      TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  trip_id      TEXT NOT NULL,
  route_id     TEXT,
  service_id   TEXT,
  headsign     TEXT,
  direction_id INTEGER,
  PRIMARY KEY (feed_id, trip_id)
);

CREATE TABLE IF NOT EXISTS gtfs_stop_times (
  feed_id        TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  trip_id        TEXT NOT NULL,
  stop_id        TEXT NOT NULL,
  stop_sequence  INTEGER,
  departure_time TEXT,              -- 'HH:MM:SS' (24時超あり)
  arrive_time    TEXT
);

CREATE TABLE IF NOT EXISTS gtfs_calendar (
  feed_id    TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  mon INTEGER, tue INTEGER, wed INTEGER, thu INTEGER, fri INTEGER, sat INTEGER, sun INTEGER,
  start_date TEXT, end_date TEXT,
  PRIMARY KEY (feed_id, service_id)
);

CREATE TABLE IF NOT EXISTS gtfs_calendar_dates (
  feed_id        TEXT NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  service_id     TEXT NOT NULL,
  date           TEXT NOT NULL,     -- 'YYYYMMDD'
  exception_type INTEGER            -- 1=運行追加, 2=運休
);

CREATE INDEX IF NOT EXISTS idx_gtfs_stop_times_lookup ON gtfs_stop_times(feed_id, stop_id, departure_time);
CREATE INDEX IF NOT EXISTS idx_gtfs_stop_times_trip ON gtfs_stop_times(feed_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_gtfs_stops_geo ON gtfs_stops(feed_id, lat, lng);
CREATE INDEX IF NOT EXISTS idx_gtfs_trips_route ON gtfs_trips(feed_id, route_id);
