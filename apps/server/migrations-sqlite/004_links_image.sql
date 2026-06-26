-- 場所のイメージ画像 URL (Web/Places から取得) と、資料 Web ページ (複数リンク)。
ALTER TABLE places ADD COLUMN image_url TEXT;

CREATE TABLE IF NOT EXISTS place_links (
  id         TEXT PRIMARY KEY,
  place_id   TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  title      TEXT,
  source     TEXT,  -- 'manual' | 'places' | 'crawl' | 'recommend'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_place_links_place ON place_links(place_id);
