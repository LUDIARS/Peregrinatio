import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { defaultBaseName, isFacilityListingPlace, suggestBaseFacilities } from '../place-enrichment/base-facilities.js';
import type { PlaceFacility, TripPlace } from '../types.js';

const app = new Hono();

async function member(tripId: string, placeId: string): Promise<TripPlace | null> {
  const [row] = (await sql`
    SELECT p.*, tp.is_base, tp.base_name, tp.base_name_source, tp.checkin_time, tp.checkout_time, tp.postponed
    FROM places p JOIN trip_places tp ON tp.place_id=p.id
    WHERE tp.trip_id=${tripId} AND tp.place_id=${placeId}`) as TripPlace[];
  return row ?? null;
}

async function facilities(tripId: string, placeId: string): Promise<PlaceFacility[]> {
  return (await sql`
    SELECT f.*, CASE WHEN w.facility_id IS NULL THEN 0 ELSE 1 END AS wanted
    FROM place_facilities f
    LEFT JOIN trip_place_facility_wants w
      ON w.facility_id=f.id AND w.place_id=f.place_id AND w.trip_id=${tripId}
    WHERE f.place_id=${placeId}
    ORDER BY f.order_index, f.created_at`) as PlaceFacility[];
}

async function tripFacilities(tripId: string): Promise<PlaceFacility[]> {
  return (await sql`
    SELECT f.*, CASE WHEN w.facility_id IS NULL THEN 0 ELSE 1 END AS wanted
    FROM place_facilities f
    JOIN trip_places tp ON tp.place_id=f.place_id AND tp.trip_id=${tripId}
    LEFT JOIN trip_place_facility_wants w
      ON w.facility_id=f.id AND w.place_id=f.place_id AND w.trip_id=${tripId}
    ORDER BY f.place_id, f.order_index, f.created_at`) as PlaceFacility[];
}

app.get('/api/trips/:tripId/facilities', async (c) => {
  return c.json(await tripFacilities(c.req.param('tripId')));
});

app.get('/api/trips/:tripId/places/:placeId/facilities', async (c) => {
  const tripId = c.req.param('tripId');
  const placeId = c.req.param('placeId');
  if (!await member(tripId, placeId)) return c.json({ error: 'この旅に場所がありません' }, 404);
  return c.json(await facilities(tripId, placeId));
});

app.post('/api/trips/:tripId/places/:placeId/facilities/suggest', async (c) => {
  const tripId = c.req.param('tripId');
  const placeId = c.req.param('placeId');
  const place = await member(tripId, placeId);
  if (!place) return c.json({ error: 'この旅に場所がありません' }, 404);
  if (!isFacilityListingPlace(place)) {
    return c.json({ error: '拠点または複合施設として認識できません' }, 400);
  }

  let suggestion;
  try {
    suggestion = await suggestBaseFacilities(place);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Haikuによる提案に失敗しました';
    return c.json({ error: message }, 502);
  }

  if (place.is_base === 1 && place.base_name_source !== 'manual') {
    const baseName = suggestion.baseName ?? place.base_name ?? defaultBaseName(place.name);
    await sql`UPDATE trip_places SET base_name=${baseName}, base_name_source=${suggestion.baseName ? 'haiku' : 'fallback'}
      WHERE trip_id=${tripId} AND place_id=${placeId}`;
  }
  for (const [index, name] of suggestion.facilities.entries()) {
    await sql`INSERT INTO place_facilities (id, place_id, name, source, order_index, created_at)
      VALUES (${newId()}, ${placeId}, ${name}, ${'haiku'}, ${index}, ${nowIso()})
      ON CONFLICT(place_id, name) DO UPDATE SET order_index=excluded.order_index, source=excluded.source`;
  }
  return c.json({ place: await member(tripId, placeId), facilities: await facilities(tripId, placeId) });
});

app.patch('/api/trips/:tripId/places/:placeId/facilities/:facilityId', async (c) => {
  const tripId = c.req.param('tripId');
  const placeId = c.req.param('placeId');
  const facilityId = c.req.param('facilityId');
  const body = (await c.req.json().catch(() => ({}))) as { wanted?: boolean };
  const [facility] = (await sql`SELECT id FROM place_facilities WHERE id=${facilityId} AND place_id=${placeId}`) as { id: string }[];
  if (!await member(tripId, placeId) || !facility) return c.json({ error: '設備が見つかりません' }, 404);
  if (body.wanted === true) {
    await sql`INSERT OR IGNORE INTO trip_place_facility_wants (trip_id, place_id, facility_id, created_at)
      VALUES (${tripId}, ${placeId}, ${facilityId}, ${nowIso()})`;
  } else if (body.wanted === false) {
    await sql`DELETE FROM trip_place_facility_wants
      WHERE trip_id=${tripId} AND place_id=${placeId} AND facility_id=${facilityId}`;
  } else {
    return c.json({ error: 'wanted must be boolean' }, 400);
  }
  const rows = await facilities(tripId, placeId);
  return c.json(rows.find((row) => row.id === facilityId));
});

export default app;
