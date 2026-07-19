// 新幹線/飛行機の予約サジェスト API。
//   GET /api/trips/:id/reservation-suggestions
// 旅の出発地点 (自宅/集合地点) と拠点 (なければ全場所) の座標から、長距離移動の
// 新幹線/飛行機を特定し予約サイトを提示する。判定は transit/reservation.ts (決定的)。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { suggestForLeg, type LatLng, type ReservationSuggestion } from '../transit/reservation.js';
import type { Trip, TripPlace } from '../types.js';

const app = new Hono();

/** サジェスト 1 件にどの目的地に対するものかを添える。 */
export interface ReservationSuggestionView extends ReservationSuggestion {
  destination: string;
}

app.get('/api/trips/:id/reservation-suggestions', async (c) => {
  const id = c.req.param('id');
  const [trip] = (await sql`SELECT * FROM trips WHERE id=${id}`) as Trip[];
  if (!trip) return c.json({ error: 'not found' }, 404);

  const places = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${id}`) as TripPlace[];
  const withCoords = places.filter((p) => p.lat != null && p.lng != null);
  const bases = withCoords.filter((p) => p.is_base === 1);

  // 出発地点: 旅の origin (自宅/集合地点) を優先。無ければ拠点 (なければ任意の場所) を起点に。
  let origin: LatLng | null = null;
  let originName = '';
  if (trip.origin_kind !== 'none' && trip.origin_lat != null && trip.origin_lng != null) {
    origin = { lat: trip.origin_lat, lng: trip.origin_lng };
    originName = trip.origin_label ?? '出発地点';
  } else {
    const b0 = bases[0] ?? withCoords[0];
    if (b0) { origin = { lat: b0.lat as number, lng: b0.lng as number }; originName = b0.name; }
  }
  if (!origin) return c.json({ origin: null, suggestions: [] });

  // 目的地候補: 拠点優先 (無ければ全場所)。出発地点から各候補への移動をサジェスト。
  const candidates = bases.length ? bases : withCoords;
  const seen = new Set<string>();
  const suggestions: ReservationSuggestionView[] = [];
  for (const d of candidates) {
    const legs = suggestForLeg(origin, { lat: d.lat as number, lng: d.lng as number });
    for (const s of legs) {
      const key = `${s.mode}:${s.from}:${s.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ ...s, destination: d.name });
    }
  }
  // 距離が長い順に並べる (主要移動を上に)。
  suggestions.sort((a, b) => b.distance_km - a.distance_km);
  return c.json({ origin: originName, suggestions });
});

export default app;
