-- 周辺候補のアクセス印 (🚕 初乗り圏 / 🚏 バス停近い / 🚌 シャトルあり) の外部問い合わせ結果キャッシュ。
-- cache_key は旅の場所なら place_id、未保存の候補 (プランの new_places・検索結果) なら google_place_id。
-- kind: 'bus_stop_places' (Places Nearby の最寄りバス停) / 'station_places' (Places の最寄り駅) /
--       'shuttle_llm' (施設サマリーのクロール→LLM が抽出したシャトルバスの有無・根拠)。
-- タクシー初乗り距離は app_settings の 'taxi_first_fare_m' (既定 1200m)。
CREATE TABLE IF NOT EXISTS place_access_cache (
  cache_key  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  value_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (cache_key, kind)
);
