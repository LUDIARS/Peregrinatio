// HTTP アプリ (ルート組み立て) の生成。
// 起動ブートストラップ (index.ts) からも、統合テストからも同じ app を作れるように
// serve()/静的配信から切り離す (SRP)。DB は呼び出し側で initSql() 済みであること。

import { Hono } from 'hono';
import { cors } from 'hono/cors';

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
import settings from './routes/settings.js';
import jobs from './routes/jobs.js';
import reservation from './routes/reservation.js';
import autosearch from './routes/autosearch.js';

/** API ルートだけを束ねた Hono アプリ (静的配信なし)。 */
export function buildApiApp(): Hono {
  const app = new Hono();
  app.use('/api/*', cors());
  app.get('/healthz', (c) => c.json({ ok: true }));

  for (const r of [map, trips, days, places, itinerary, crawl, links, search, images, routing, pdf, recommend, placeMedia, baseSummary, hotel, timetable, settings, jobs, reservation, autosearch]) {
    app.route('/', r);
  }
  return app;
}
