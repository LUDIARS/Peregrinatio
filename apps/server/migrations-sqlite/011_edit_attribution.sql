-- 複数人編集の表示名を記録する。
--   places.status_by         : 「気になる/訪問済み」を最後に変更した人の表示名
--   itinerary_items.edited_by: 日程 (しおり) の予定を最後に作成/編集した人の表示名
-- 表示名はクライアントが x-pe-user ヘッダで送る (最大8文字、ローカル設定)。
ALTER TABLE places ADD COLUMN status_by TEXT;
ALTER TABLE itinerary_items ADD COLUMN edited_by TEXT;
