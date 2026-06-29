-- 公共交通(乗換)の出発/到着時刻を区間に保存する (Google マップの複数候補から選んだ経路)。
-- 「到着時刻を優先」表示や、最終路線の時刻表での時間調整計算に使う。
ALTER TABLE route_legs ADD COLUMN depart_time TEXT;
ALTER TABLE route_legs ADD COLUMN arrive_time TEXT;

ALTER TABLE route_segment_modes ADD COLUMN depart_time TEXT;
ALTER TABLE route_segment_modes ADD COLUMN arrive_time TEXT;
