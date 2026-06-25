// Peregrinatio サーバ設定。
// 秘密 (API キー) は env フォールバックを使わず、ローカル untracked ファイル
// data/secrets.local.json から hydrateSecrets() で注入する ([[feedback_no_env_fallback_for_secrets]])。
// 未設定の機能は「無効」を明示 (map-config の enabled=false) するか、呼び出し時に即エラーにする。

import { readFile } from 'node:fs/promises';
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
  // アップロード/合成画像・生成 PDF の保存先 (gitignore 済)。
  uploadsDir: resolve(PROJECT_ROOT, 'apps/server/uploads'),
  exportsDir: resolve(PROJECT_ROOT, 'apps/server/exports'),
};

export type Config = typeof config;

/**
 * data/secrets.local.json (untracked) を読んで config に流し込む。
 * 無ければ何もしない (= 各機能が「未設定」として明示エラー/無効化する)。
 * 形式: { "googleMapsApiKey": "...", "databaseUrl": "...", "llmBackend": "cli" }
 */
export async function hydrateSecrets(): Promise<void> {
  const path = resolve(PROJECT_ROOT, 'data/secrets.local.json');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return; // 未設定。silent fallback はしない (使う側が即エラー)。
  }
  const s = JSON.parse(text) as Record<string, unknown>;
  if (typeof s.googleMapsApiKey === 'string') config.googleMaps.apiKey = s.googleMapsApiKey;
  if (typeof s.databaseUrl === 'string') config.databaseUrl = s.databaseUrl;
  if (s.llmBackend === 'cli' || s.llmBackend === 'api') config.llmBackend = s.llmBackend;
}
