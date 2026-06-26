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

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`Peregrinatio server on http://${config.host}:${info.port}`);
  });
  // 待受エラー (EADDRINUSE 等) は握りつぶさず必ず明示して fail-fast する。
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[fatal] ポート ${config.port} は既に使用中です (EADDRINUSE)。既存のサーバを停止してから再起動してください。`);
    } else {
      console.error('[fatal] サーバ待受でエラー:', err);
    }
    process.exit(1);
  });

  // 拠点サマリーの自動生成バックグラウンドを開始。
  if (config.baseSummary.enabled) startBaseSummaryQueue();

  // 終了シグナルで WAL をチェックポイントして安全に閉じる (取りこぼし防止)。
  const shutdown = () => { void sql.end().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// プロセスレベルでも例外/未処理 rejection を握りつぶさず必ず出力して fail-fast する。
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('[fatal] 起動に失敗:', err);
  process.exit(1);
});
