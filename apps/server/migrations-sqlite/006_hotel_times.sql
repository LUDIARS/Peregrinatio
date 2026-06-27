-- 拠点がホテルの場合のチェックイン/チェックアウト時刻 (旅ごとのメンバーシップ属性)。
-- 時刻のみ (HH:MM 文字列)。実日付は旅の初日/最終日で決まるため持たない。
-- チェックイン時刻は自動取得後にユーザが調整可能。
ALTER TABLE trip_places ADD COLUMN checkin_time TEXT;
ALTER TABLE trip_places ADD COLUMN checkout_time TEXT;
