// HTTP アプリ (ルート組み立て) の生成。
// 起動ブートストラップ (index.ts) からも、統合テストからも同じ app を作れるように
// serve()/静的配信から切り離す (SRP)。DB は呼び出し側で initSql() 済みであること。
// @implements SPEC-CF-ACCESS-VERIFY

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestLogger } from './observability/request-log.js';
import { cfAccessMiddleware } from './security/cf-access-middleware.js';
import type { CfAccessVerifier } from './security/cf-access-verifier.js';

// 純 DB CRUD (スパイン)
import map from './routes/map.js';
import trips from './routes/trips.js';
import days from './routes/days.js';
import places from './routes/places.js';
import itinerary from './routes/itinerary.js';
// 機能ルータ (各 packages を使う)
import crawl from './routes/crawl.js';
import links from './routes/links.js';
import search from './routes/search.js';
import images from './routes/images.js';
import routing from './routes/routing.js';
import pdf from './routes/pdf.js';
import recommend from './routes/recommend.js';
import placeMedia from './routes/place-media.js';
import baseSummary from './routes/base-summary.js';
import hotel from './routes/hotel.js';
import timetable from './routes/timetable.js';
import express from './routes/express.js';
import accessMarks from './routes/access-marks.js';
import settings from './routes/settings.js';
import jobs from './routes/jobs.js';
import reservation from './routes/reservation.js';
import autosearch from './routes/autosearch.js';
import gtfs from './routes/gtfs.js';
import checkItems from './routes/check-items.js';
import facilities from './routes/facilities.js';
import sharing from './routes/sharing.js';
import suggest from './routes/suggest.js';

export interface BuildApiAppOptions {
  /** Cloudflare Access の検証器。無ければ検証しない (runtime-config に cloudflareAccess が無いとき)。 */
  cfAccess?: CfAccessVerifier;
}

/** API ルートだけを束ねた Hono アプリ (静的配信なし)。 */
export function buildApiApp(options: BuildApiAppOptions = {}): Hono {
  const app = new Hono();
  // 全リクエストの所要時間/結果を計測して JSONL に記録 (最初に噛ませる)。
  app.use('*', requestLogger());
  // 公開入口 (Tunnel) から来た要求は Cloudflare Access の JWT を確かめる。後から足す静的配信・共有リンクも
  // この '*' の後ろに付くので、すべて鍵の内側になる。
  if (options.cfAccess) app.use('*', cfAccessMiddleware(options.cfAccess));
  app.use('/api/*', cors());
  app.get('/healthz', (c) => c.json({ ok: true }));

  for (const r of [map, trips, days, places, itinerary, crawl, links, search, images, routing, pdf, recommend, placeMedia, baseSummary, hotel, timetable, express, accessMarks, settings, jobs, reservation, autosearch, gtfs, checkItems, facilities, sharing, suggest]) {
    app.route('/', r);
  }
  return app;
}
