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
import { startJobQueue } from './jobs/queue.js';
import { initVestigium, shutdownVestigium } from './observability/vestigium.js';

async function main() {
  // 横断ログを最初に立ち上げる (以降の console.* も JSONL に流れる)。
  initVestigium();
  await hydrateSecrets();
  initSql();
  await runMigrations();
  mkdirSync(config.uploadsDir, { recursive: true });
  mkdirSync(config.exportsDir, { recursive: true });

  const app = buildApiApp();
  // アップロード/合成画像の静的配信 (cwd=apps/server で uploads/ を指す)
  app.use('/uploads/*', serveStatic({ root: './', }));

  // 未マッチの /api/* は SPA フォールバック (HTML) ではなく JSON 404 を返す。
  // これが無いと、ルート欠落 (古いビルド等) で index.html が 200 で返り、クライアントが
  // res.json() で「Unexpected token '<'」になって原因が分かりにくくなる ([[feedback_no_silent_fallback]])。
  app.all('/api/*', (c) => c.json({ error: `Not Found: ${c.req.method} ${c.req.path}` }, 404));

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
  // 取り込みジョブ (画像解析/クロール) の順次処理キューを開始。
  if (config.jobs.enabled) startJobQueue();

  // 終了シグナルで WAL をチェックポイントし、ログ writer を flush してから閉じる。
  const shutdown = () => {
    void shutdownVestigium().finally(() => sql.end().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** クライアント切断 (リクエスト中断) 由来のエラーか。これはサーバのバグではないので致命にしない。 */
function isClientAbort(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  return !!e && (e.code === 'ECONNRESET' || e.message === 'aborted');
}

// プロセスレベルでも例外/未処理 rejection を握りつぶさず必ず出力して fail-fast する。
// ただしクライアント切断 (ECONNRESET / aborted) はプロセスを落とさずログのみ
// (長いリクエスト中にブラウザが離脱/リロードした等。サーバを巻き込まない)。
process.on('uncaughtException', (err) => {
  if (isClientAbort(err)) {
    console.warn('[warn] クライアント切断を無視:', (err as Error).message);
    return;
  }
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isClientAbort(reason)) {
    console.warn('[warn] クライアント切断を無視:', (reason as Error).message);
    return;
  }
  console.error('[fatal] unhandledRejection:', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('[fatal] 起動に失敗:', err);
  process.exit(1);
});
