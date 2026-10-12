// アクセス印 (🚕 初乗り圏 / 🚏 バス停近い / 🚌 シャトルあり) の HTTP API。
//   GET    /api/trips/:id/access-marks     旅の場所ごとの印 { [place_id]: AccessMarks }
//   GET    /api/settings/access-marks      タクシー初乗り距離
//   PUT    /api/settings/access-marks      { taxi_first_fare_m }
//   DELETE /api/settings/access-marks      既定 (1200m) に戻す
// 旅の場所一覧・プランの new_places・場所検索 (trip_id 付き) の応答にも同じ印を access_marks で付ける。
// @implements SPEC-ACCESS-ATTACH
// @implements SPEC-ACCESS-SETTINGS

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { attachAccessMarks, tripBaseOrigin } from '../access-marks/attach.js';
import { placeCandidateFactory } from '../access-marks/candidates.js';
import {
  DEFAULT_TAXI_FIRST_FARE_M,
  getTaxiFirstFareM,
  isValidTaxiFirstFare,
  MAX_TAXI_FIRST_FARE_M,
  MIN_TAXI_FIRST_FARE_M,
  resetTaxiFirstFareM,
  setTaxiFirstFareM,
} from '../access-marks/settings.js';
import type { AccessMarks } from '../access-marks/types.js';
import type { TripPlace } from '../types.js';

const app = new Hono();

app.get('/api/trips/:id/access-marks', async (c) => {
  const tripId = c.req.param('id');
  const [trip] = (await sql`SELECT id FROM trips WHERE id=${tripId}`) as { id: string }[];
  if (!trip) return c.json({ error: '旅が見つかりません' }, 404);
  const rows = (await sql`
    SELECT p.* FROM places p JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id=${tripId} AND tp.is_base = 0`) as TripPlace[];
  const marked = await attachAccessMarks(rows, await placeCandidateFactory(rows), { base: await tripBaseOrigin(tripId) });
  const out: Record<string, AccessMarks> = {};
  for (const r of marked) if (r.access_marks) out[r.id] = r.access_marks;
  return c.json(out);
});

app.get('/api/settings/access-marks', async (c) => {
  const fare = await getTaxiFirstFareM();
  return c.json({
    taxi_first_fare_m: fare.value,
    is_default: fare.is_default,
    default_taxi_first_fare_m: DEFAULT_TAXI_FIRST_FARE_M,
    min: MIN_TAXI_FIRST_FARE_M,
    max: MAX_TAXI_FIRST_FARE_M,
  });
});

app.put('/api/settings/access-marks', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { taxi_first_fare_m?: unknown };
  if (!isValidTaxiFirstFare(b.taxi_first_fare_m)) {
    return c.json({ error: `taxi_first_fare_m は ${MIN_TAXI_FIRST_FARE_M}〜${MAX_TAXI_FIRST_FARE_M} の整数 (m) で指定してください` }, 400);
  }
  await setTaxiFirstFareM(b.taxi_first_fare_m);
  return c.json({ taxi_first_fare_m: b.taxi_first_fare_m, is_default: false });
});

app.delete('/api/settings/access-marks', async (c) => {
  await resetTaxiFirstFareM();
  return c.json({ taxi_first_fare_m: DEFAULT_TAXI_FIRST_FARE_M, is_default: true });
});

export default app;
