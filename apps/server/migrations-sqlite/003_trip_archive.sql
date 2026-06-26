-- 旅のアーカイブ (ゴミ箱) フラグ。1=アーカイブ済 (一覧から退避、後でハード削除)。
ALTER TABLE trips ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
