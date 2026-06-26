import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, hydrateSecrets, PROJECT_ROOT } from './config.js';
import { initSql, sql } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { buildApiApp } from './app.js';
import { startBaseSummaryQueue } from './base-summary/queue.js';

async function main() {
  await hydrateSecrets();
  initSql();
  await runMigrations();
  mkdirSync(config.uploadsDir, { recursive: true });
  mkdirSync(config.exportsDir, { recursive: true });

  const app = buildApiApp();
  // アップロード/合成画像の静的配信 (cwd=apps/server で uploads/ を指す)
  app.use('/uploads/*', serveStatic({ root: './', }));

  // 本番 (単一オリジン): apps/web/dist を配信。dev は vite:5179 を使うのでこちらは未ビルドでも可。
  // 実ファイルがあれば serveStatic が返し、無ければ SPA フォールバックで index.html を返す
  // (BrowserRouter の deep link 用)。/api・/uploads は上で先にマッチするのでここには来ない。
  app.use('*', serveStatic({ root: '../web/dist' }));
  app.get('*', async (c) => {
    try {
      const html = await readFile(join(PROJECT_ROOT, 'apps/web/dist/index.html'), 'utf8');
      return c.html(html);
    } catch {
      return c.text('web not built — run `npm run build:web`', 404);
    }
  });

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`Peregrinatio server on http://${config.host}:${info.port}`);
  });

  // 拠点サマリーの自動生成バックグラウンドを開始。
  if (config.baseSummary.enabled) startBaseSummaryQueue();

  // 終了シグナルで WAL をチェックポイントして安全に閉じる (取りこぼし防止)。
  const shutdown = () => { void sql.end().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
