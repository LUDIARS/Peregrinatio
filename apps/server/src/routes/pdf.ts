import { Hono } from 'hono';
import puppeteer from 'puppeteer';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import type {
  Trip,
  TripDay,
  Place,
  PlaceImage,
  ItineraryItem,
  RouteLeg,
} from '../types.js';

const app = new Hono();

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** DB の URL パス (/uploads/...) を setContent から確実に読める http URL にする。 */
const imageUrl = (path: string): string =>
  `http://${config.host}:${config.port}${path.startsWith('/') ? path : `/${path}`}`;

function fmtPeriod(trip: Trip): string {
  if (trip.start_date && trip.end_date) return `${trip.start_date} 〜 ${trip.end_date}`;
  return trip.start_date ?? trip.end_date ?? '';
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return `${h}時間${m % 60}分`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

function placeBlock(p: Place, composite: PlaceImage | undefined): string {
  const img = composite
    ? `<div class="img"><img src="${esc(imageUrl(composite.path))}" alt=""></div>`
    : '';
  return `
    <div class="place">
      <div class="place-name">${esc(p.name)}</div>
      ${p.address ? `<div class="place-addr">${esc(p.address)}</div>` : ''}
      ${p.summary ? `<div class="place-summary">${esc(p.summary)}</div>` : ''}
      ${img}
    </div>`;
}

function legBlock(leg: RouteLeg, placeMap: Map<string, Place>): string {
  const from = leg.from_place_id ? placeMap.get(leg.from_place_id)?.name ?? '' : '';
  const to = leg.to_place_id ? placeMap.get(leg.to_place_id)?.name ?? '' : '';
  const parts = [fmtDuration(leg.duration_sec), fmtDistance(leg.distance_m), leg.fare_text ?? '']
    .filter(Boolean)
    .join(' / ');
  return `<div class="leg">${esc(from)} → ${esc(to)}（${esc(leg.mode)}${parts ? ` ${esc(parts)}` : ''}）</div>`;
}

function buildHtml(
  trip: Trip,
  days: TripDay[],
  itemsByDay: Map<string, ItineraryItem[]>,
  legsByDay: Map<string, RouteLeg[]>,
  placeMap: Map<string, Place>,
  compositeByPlace: Map<string, PlaceImage>,
): string {
  const daySections = days
    .map((d) => {
      const items = itemsByDay.get(d.id) ?? [];
      const itemHtml = items
        .map((it) => {
          const time = it.planned_time ? `<span class="time">${esc(it.planned_time)}</span>` : '';
          const place = it.place_id ? placeMap.get(it.place_id) : undefined;
          const main = place
            ? placeBlock(place, compositeByPlace.get(place.id))
            : `<div class="note">${esc(it.note ?? '')}</div>`;
          return `<div class="item"><div class="item-head">${time}<span class="kind">${esc(it.kind)}</span></div>${main}${it.place_id && it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</div>`;
        })
        .join('');
      const legs = legsByDay.get(d.id) ?? [];
      const legHtml = legs.length
        ? `<div class="legs"><div class="legs-title">移動</div>${legs.map((l) => legBlock(l, placeMap)).join('')}</div>`
        : '';
      const heading = [d.date, d.title].filter(Boolean).join(' ');
      return `
        <section class="day">
          <h2>Day ${d.day_index + 1}${heading ? ` — ${esc(heading)}` : ''}</h2>
          ${d.notes ? `<div class="day-notes">${esc(d.notes)}</div>` : ''}
          ${itemHtml || '<div class="empty">予定なし</div>'}
          ${legHtml}
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif; color: #222; margin: 0; }
  .cover { text-align: center; padding: 80px 24px; page-break-after: always; }
  .cover h1 { font-size: 32px; margin: 0 0 16px; }
  .cover .period { font-size: 16px; color: #555; }
  .cover .notes { margin-top: 24px; font-size: 13px; color: #666; white-space: pre-wrap; }
  .day { padding: 16px 24px; page-break-inside: avoid; }
  .day h2 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 6px; }
  .day-notes { font-size: 12px; color: #666; margin-bottom: 8px; white-space: pre-wrap; }
  .item { margin: 10px 0; padding: 8px 10px; border-left: 3px solid #bbb; page-break-inside: avoid; }
  .item-head { font-size: 12px; color: #555; margin-bottom: 4px; }
  .time { font-weight: bold; margin-right: 8px; }
  .kind { background: #eee; border-radius: 4px; padding: 1px 6px; }
  .place-name { font-size: 15px; font-weight: bold; }
  .place-addr { font-size: 12px; color: #666; }
  .place-summary { font-size: 12px; margin: 4px 0; white-space: pre-wrap; }
  .note { font-size: 12px; color: #444; white-space: pre-wrap; }
  .img { margin-top: 6px; }
  .img img { max-width: 100%; max-height: 360px; object-fit: contain; border: 1px solid #ddd; }
  .legs { margin-top: 10px; padding: 8px 10px; background: #f7f7f7; border-radius: 6px; }
  .legs-title { font-size: 12px; font-weight: bold; color: #555; margin-bottom: 4px; }
  .leg { font-size: 12px; color: #444; }
  .empty { font-size: 12px; color: #999; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${esc(trip.title)}</h1>
    <div class="period">${esc(fmtPeriod(trip))}</div>
    ${trip.notes ? `<div class="notes">${esc(trip.notes)}</div>` : ''}
  </div>
  ${daySections}
</body>
</html>`;
}

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

  const html = buildHtml(trip, days, itemsByDay, legsByDay, placeMap, compositeByPlace);

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
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
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
