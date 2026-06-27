-- 旅の出発地点 (自宅 / 集合地点) と往復経路の自動算出。
-- origin_kind: 'none'(既定=拠点起点で出発地点なし) | 'home'(自宅) | 'meeting'(拠点以外の集合地点)。
-- 出発地点が設定されると、初日の最初の予定への往路 + 最終日の最後の予定からの復路を自動算出する。
-- 座標は選択時にスナップショット (自宅は app_settings から、集合地点はジオコーディングから) して旅に保持する。
ALTER TABLE trips ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE trips ADD COLUMN origin_label TEXT;
ALTER TABLE trips ADD COLUMN origin_address TEXT;
ALTER TABLE trips ADD COLUMN origin_lat REAL;
ALTER TABLE trips ADD COLUMN origin_lng REAL;

-- route_legs の端点ラベル。出発地点/帰着地点は place ではないため place 名を持てない。
-- 通常の区間は null (UI が place 名を引く)。出発地点絡みの区間にのみラベルを入れる。
ALTER TABLE route_legs ADD COLUMN from_label TEXT;
ALTER TABLE route_legs ADD COLUMN to_label TEXT;

-- アプリ全体の設定 (自宅住所など、旅をまたいで使い回す単一値)。key/value。
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
