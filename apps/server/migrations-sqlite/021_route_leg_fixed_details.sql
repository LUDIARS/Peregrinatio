-- ユーザが確定した区間情報を、経路再計算後も保持する。
-- 公共交通は大分類 mode='transit' のまま、実際の手段を transit_kind で区別する。
ALTER TABLE route_legs ADD COLUMN transit_kind TEXT;
ALTER TABLE route_legs ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE route_segment_modes ADD COLUMN transit_kind TEXT;
ALTER TABLE route_segment_modes ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0;
