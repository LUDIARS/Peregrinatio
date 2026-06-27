-- 取り込みジョブ (画像解析/クロール) を順次処理するキュー。
-- Quaestor/Memoria と同じ「DBにジョブを積んで worker が1件ずつ処理」する方式。
-- is_new_place=1 のジョブは「取り込みで新規作成したドラフト place」を指し、
-- 成立(座標が付く)するまで場所リスト/地図から隠す。未成立は needs_info で据え置き。
CREATE TABLE IF NOT EXISTS place_jobs (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id     TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'image' | 'crawl'
  status       TEXT NOT NULL DEFAULT 'pending',    -- pending | processing | done | needs_info | failed
  source_url   TEXT,                               -- crawl 用 URL
  is_new_place INTEGER NOT NULL DEFAULT 0,         -- 取り込みで新規作成した place か (1=ドラフト)
  missing_info TEXT,                               -- 成立しない時の不足情報 (ユーザ向け文言)
  error        TEXT,                               -- failed の理由
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_place_jobs_trip ON place_jobs(trip_id);
CREATE INDEX IF NOT EXISTS idx_place_jobs_status ON place_jobs(status);
CREATE INDEX IF NOT EXISTS idx_place_jobs_place ON place_jobs(place_id);
