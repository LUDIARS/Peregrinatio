-- 拠点 (ホテル/目的地など、周辺地図の中心にする place) フラグ。
ALTER TABLE places ADD COLUMN is_base INTEGER NOT NULL DEFAULT 0;
