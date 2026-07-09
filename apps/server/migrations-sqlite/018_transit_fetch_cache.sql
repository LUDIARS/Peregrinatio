-- transit-fetch (Google マップ乗換のヘッドレス取得→LLM 解析) は Puppeteer + LLM で重い。
-- 同じ区間 (from/to 座標) への再取得はまずこのキャッシュを見て、鮮度 (TTL) 内なら再取得しない。
-- キーは緯度経度を 5 桁 (≒約1m) に丸めた "fromLat,fromLng|toLat,toLng"。
-- transit は時刻依存のため fetched_at で TTL 判定し、古ければ取り直す (config.transit.fetchCacheTtlMs)。
CREATE TABLE IF NOT EXISTS transit_fetch_cache (
  cache_key    TEXT PRIMARY KEY,
  from_lat     REAL NOT NULL,
  from_lng     REAL NOT NULL,
  to_lat       REAL NOT NULL,
  to_lng       REAL NOT NULL,
  options_json TEXT NOT NULL,            -- TransitOption[] の JSON
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transit_fetch_cache_fetched ON transit_fetch_cache(fetched_at);
