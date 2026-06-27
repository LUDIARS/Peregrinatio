// Peregrinatio サーバ設定。
// 秘密 (API キー) は env フォールバックを使わず、ローカル暗号化 config
// (peregrinatio.config.json / AES-256-GCM) から hydrateSecrets() で注入する
// ([[feedback_no_env_fallback_for_secrets]] / 非平文 RULE§7)。登録は `npm run config-set`。
// 未設定の機能は「無効」を明示 (map-config の enabled=false) するか、呼び出し時に即エラーにする。

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dir = dirname(fileURLToPath(import.meta.url));
// apps/server/src → プロジェクトルートは 3 階層上
export const PROJECT_ROOT = resolve(_dir, '../../..');

export const config = {
  port: 8090,
  host: '127.0.0.1',
  // 空 = SQLite (data/peregrinatio.sqlite)。db/index.ts 参照。
  databaseUrl: '',
  // LLM backend。LUDIARS 規約に従い既定は claude CLI (API 不使用)。
  llmBackend: 'cli' as 'cli' | 'api',
  // claude CLI / モデル。
  llm: {
    cliPath: 'claude',
    visionModel: 'claude-haiku-4-5-20251001',
    summaryModel: 'claude-haiku-4-5-20251001',
  },
  // Web クロール (PoliteFetcher)。
  crawl: {
    maxPages: 8,
    fetchTimeoutMs: 15_000,
    minIntervalMs: 2_000,
    respectRobots: true,
    userAgent: 'PeregrinatioBot/0.1 (+https://github.com/LUDIARS/Peregrinatio)',
  },
  // Google Maps (JS API key はブラウザに渡る。HTTP referrer 制限前提)。
  // Geocoding / Places / Routes に同一 key を使う。空ならマップ系機能は無効/エラー。
  googleMaps: {
    apiKey: '',
  },
  // 近くのおすすめ自動収集 (Places ベース) の既定検索カテゴリと範囲。
  recommend: {
    radiusM: 8_000,
    perQuery: 6,
    queries: ['観光スポット', 'レストラン', 'カフェ', '名所', 'アクティビティ 体験', 'お土産'],
  },
  // 時刻表/運行情報の自動取得。既定プロバイダは crawl-llm (URL→クロール→LLM 抽出, キー不要)。
  // 駅すぱあと(Ekispert) の契約 API キーを登録すると ekispert プロバイダが有効化する。
  transit: {
    ekispertKey: '',
    ekispertBaseUrl: 'https://api.ekispert.jp/v1/json',
  },
  // 拠点サマリー自動生成のバックグラウンド設定。
  baseSummary: {
    enabled: true,
    intervalMs: 120_000,   // 走査間隔
    minPlaces: 4,          // 拠点を含む旅にこれ以上の場所が集まったら自動要約
  },
  // 取り込みジョブ (画像解析/クロール) を 1 件ずつ順次処理するキュー。
  jobs: {
    enabled: true,
    intervalMs: 2_000,     // ポーリング間隔。pending を 1 件取り出して処理する。
  },
  // アップロード/合成画像・生成 PDF の保存先 (gitignore 済)。
  uploadsDir: resolve(PROJECT_ROOT, 'apps/server/uploads'),
  exportsDir: resolve(PROJECT_ROOT, 'apps/server/exports'),
};

export type Config = typeof config;

/**
 * ローカル暗号化 config (peregrinatio.config.json) を読んで config に流し込む。
 * 未設定なら何もしない (= 各機能が「未設定」として明示エラー/無効化する)。
 * 登録: `npm run config-set GOOGLE_MAPS_API_KEY <値 or @ファイル>`。
 * 保存キー: GOOGLE_MAPS_API_KEY (暗号化) / DATABASE_URL (平文) / LLM_BACKEND (平文)。
 */
export async function hydrateSecrets(): Promise<void> {
  const { readLocalSecrets, configPath } = await import('./secrets/store.js');
  const secrets = readLocalSecrets();
  if (!secrets) {
    console.warn(`[secrets] 暗号化 config 未設定 (${configPath()})。地図系は無効で起動します。`);
    return; // silent fallback はしない (使う側が即エラー/無効化)。
  }
  if (typeof secrets.GOOGLE_MAPS_API_KEY === 'string') config.googleMaps.apiKey = secrets.GOOGLE_MAPS_API_KEY;
  if (typeof secrets.DATABASE_URL === 'string') config.databaseUrl = secrets.DATABASE_URL;
  if (secrets.LLM_BACKEND === 'cli' || secrets.LLM_BACKEND === 'api') config.llmBackend = secrets.LLM_BACKEND;
  if (typeof secrets.EKISPERT_API_KEY === 'string') config.transit.ekispertKey = secrets.EKISPERT_API_KEY;

  const applied = ['GOOGLE_MAPS_API_KEY', 'DATABASE_URL', 'LLM_BACKEND', 'EKISPERT_API_KEY'].filter((k) => secrets[k]);
  if (applied.length > 0) console.log(`[secrets] hydrated ${applied.length} key(s): ${applied.join(', ')}`);
}
