import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mkdirSync } from 'node:fs';
import { config, hydrateSecrets } from './config.js';
import { initSql } from './db/index.js';
import { runMigrations } from './db/migrate.js';

// 純 DB CRUD (スパイン)
import map from './routes/map.js';
import trips from './routes/trips.js';
import days from './routes/days.js';
import places from './routes/places.js';
import itinerary from './routes/itinerary.js';
// 機能ルータ (各 packages を使う)
import crawl from './routes/crawl.js';
import search from './routes/search.js';
import images from './routes/images.js';
import routing from './routes/routing.js';
import pdf from './routes/pdf.js';

async function main() {
  await hydrateSecrets();
  initSql();
  await runMigrations();
  mkdirSync(config.uploadsDir, { recursive: true });
  mkdirSync(config.exportsDir, { recursive: true });

  const app = new Hono();
  app.use('/api/*', cors());
  // アップロード/合成画像の静的配信 (cwd=apps/server で uploads/ を指す)
  app.use('/uploads/*', serveStatic({ root: './', }));

  app.get('/healthz', (c) => c.json({ ok: true }));

  for (const r of [map, trips, days, places, itinerary, crawl, search, images, routing, pdf]) {
    app.route('/', r);
  }

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`Peregrinatio server on http://${config.host}:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
