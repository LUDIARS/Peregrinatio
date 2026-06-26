import { Hono } from 'hono';
import puppeteer from 'puppeteer';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { buildBrochureHtml } from '../pdf/brochure.js';
import type {
  Trip,
  TripDay,
  Place,
  PlaceImage,
  ItineraryItem,
  RouteLeg,
} from '../types.js';

const app = new Hono();

/** Puppeteer のフッター (中央にページ番号)。日本語フォントは継承させる。 */
const footerTemplate = `
  <div style="width:100%; font-size:8px; color:#9aa0a6; padding:0 12mm; display:flex; justify-content:space-between; font-family:sans-serif;">
    <span>Peregrinatio</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

/** GET /api/trips/:id/pdf — しおり PDF を Puppeteer でレンダリングして返す。 */
app.get('/api/trips/:id/pdf', async (c) => {
  const tripId = c.req.param('id');
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${tripId}`) as Trip[];
  if (!trip) return c.json({ error: 'trip not found' }, 404);

  const days = (await sql`SELECT * FROM trip_days WHERE trip_id=${tripId} ORDER BY day_index`) as TripDay[];
  const places = (await sql`
    SELECT p.* FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id=${tripId}`) as Place[];
  const placeMap = new Map(places.map((p) => [p.id, p]));

  const composites = (await sql`
    SELECT pi.* FROM place_images pi
    JOIN trip_places tp ON tp.place_id = pi.place_id
    WHERE tp.trip_id=${tripId} AND pi.kind='composite'
    ORDER BY pi.created_at`) as PlaceImage[];
  const compositeByPlace = new Map<string, PlaceImage>();
  for (const ci of composites) if (!compositeByPlace.has(ci.place_id)) compositeByPlace.set(ci.place_id, ci);

  const itemsByDay = new Map<string, ItineraryItem[]>();
  const legsByDay = new Map<string, RouteLeg[]>();
  for (const d of days) {
    const items = (await sql`
      SELECT * FROM itinerary_items WHERE day_id=${d.id}
      ORDER BY planned_time IS NULL, planned_time, order_index`) as ItineraryItem[];
    itemsByDay.set(d.id, items);
    const legs = (await sql`
      SELECT * FROM route_legs WHERE day_id=${d.id} ORDER BY computed_at`) as RouteLeg[];
    legsByDay.set(d.id, legs);
  }

  const html = buildBrochureHtml({
    trip, days, itemsByDay, legsByDay, placeMap, compositeByPlace,
    assetBase: `http://${config.host}:${config.port}`,
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
  } as unknown as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      // 表紙のヒーロー写真を全面に出すため上下マージンは小さめ。本文側は CSS の padding で確保。
      margin: { top: '0mm', right: '0mm', bottom: '12mm', left: '0mm' },
    });
    const ab = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `inline; filename="trip-${tripId}.pdf"`);
    return c.body(ab);
  } finally {
    await browser.close();
  }
});

export default app;
