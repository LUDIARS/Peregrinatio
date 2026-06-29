-- Google マップで検索した公共交通(乗換)経路の解析結果を区間ごとに保存する (暫定。将来 ODPT へ移行)。
-- Routes/Directions API は日本の transit を提供しないため、ユーザが Google マップの結果を
-- 貼り付け→LLM 解析した所要/運賃/乗換要約をここに持ち、経路再計算 (並べ替え) でも保持する。
ALTER TABLE route_segment_modes ADD COLUMN duration_sec INTEGER;
ALTER TABLE route_segment_modes ADD COLUMN fare_text TEXT;
ALTER TABLE route_segment_modes ADD COLUMN note TEXT;

-- route_legs にも乗換要約 (路線/乗換) を表示用に持たせる。
ALTER TABLE route_legs ADD COLUMN note TEXT;
