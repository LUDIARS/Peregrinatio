// 時刻表 / 運行情報。データ源 (NAVITIME/駅すぱあと/ODPT 等) は未配線。
// 手入力で end-to-end 動く骨組み + fetch/refresh の差し替え口 (既定は未対応を明示)。
//   GET/POST   /api/trips/:id/timetables
//   DELETE     /api/timetables/:id
//   GET/POST   /api/timetables/:id/departures
//   DELETE     /api/departures/:id
//   POST       /api/timetables/:id/fetch              (差し替え可能・既定 501)
//   GET/POST   /api/trips/:id/service-alerts
//   POST       /api/trips/:id/service-alerts/refresh  (差し替え可能・既定 501)

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TimetableKind } from '../types.js';

const app = new Hono();

const VALID_KINDS: readonly TimetableKind[] = ['shinkansen', 'bus', 'train'];

// ── 時刻表ボード ──────────────────────────────────────────────────────────
app.get('/api/trips/:id/timetables', async (c) => {
  const rows = (await sql`
    SELECT * FROM timetables WHERE trip_id=${c.req.param('id')} ORDER BY created_at`) as Timetable[];
  return c.json(rows);
});

app.post('/api/trips/:id/timetables', async (c) => {
  const trip_id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as Partial<Timetable>;
  const kind: TimetableKind = VALID_KINDS.includes(b.kind as TimetableKind) ? (b.kind as TimetableKind) : 'train';
  const id = newId();
  await sql`INSERT INTO timetables (id, trip_id, kind, line_name, from_station, to_station, notes)
    VALUES (${id}, ${trip_id}, ${kind}, ${b.line_name ?? null}, ${b.from_station ?? null}, ${b.to_station ?? null}, ${b.notes ?? null})`;
  const [t] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  return c.json(t);
});

app.delete('/api/timetables/:id', async (c) => {
  await sql`DELETE FROM timetables WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// ── 便 (手入力) ──────────────────────────────────────────────────────────
app.get('/api/timetables/:id/departures', async (c) => {
  const rows = (await sql`
    SELECT * FROM timetable_departures WHERE timetable_id=${c.req.param('id')}
    ORDER BY order_index, depart_time`) as TimetableDeparture[];
  return c.json(rows);
});

app.post('/api/timetables/:id/departures', async (c) => {
  const timetable_id = c.req.param('id');
  const [tt] = (await sql`SELECT id FROM timetables WHERE id=${timetable_id}`) as { id: string }[];
  if (!tt) return c.json({ error: 'timetable not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Partial<TimetableDeparture>;
  const cnt = (await sql`SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${timetable_id}`) as { n: number }[];
  const order_index = typeof b.order_index === 'number' ? b.order_index : (cnt[0]?.n ?? 0);
  const id = newId();
  await sql`INSERT INTO timetable_departures
    (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
    VALUES (${id}, ${timetable_id}, ${b.depart_time ?? null}, ${b.arrive_time ?? null}, ${b.train_name ?? null},
            ${b.platform ?? null}, ${b.fare_text ?? null}, ${b.note ?? null}, ${order_index})`;
  const [d] = (await sql`SELECT * FROM timetable_departures WHERE id=${id}`) as TimetableDeparture[];
  return c.json(d);
});

app.delete('/api/departures/:id', async (c) => {
  await sql`DELETE FROM timetable_departures WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

// ── 取得 (差し替え可能プロバイダ。既定は未対応を明示) ──────────────────────
app.post('/api/timetables/:id/fetch', async (c) => {
  return c.json(
    {
      error: '時刻表の自動取得データ源が未設定です。手入力で便を追加してください。',
      hint: 'NAVITIME/駅すぱあと(契約) または ODPT(登録) を fetch プロバイダとして配線すると有効になります。',
    },
    501,
  );
});

// ── 運行情報 (手入力 + refresh スタブ) ─────────────────────────────────────
app.get('/api/trips/:id/service-alerts', async (c) => {
  const rows = (await sql`
    SELECT * FROM service_alerts WHERE trip_id=${c.req.param('id')} ORDER BY created_at DESC`) as ServiceAlert[];
  return c.json(rows);
});

app.post('/api/trips/:id/service-alerts', async (c) => {
  const trip_id = c.req.param('id');
  const b = pick<ServiceAlert>(await c.req.json().catch(() => ({})), [
    'line_name', 'severity', 'title', 'body', 'source_url',
  ]);
  const id = newId();
  await sql`INSERT INTO service_alerts (id, trip_id, line_name, severity, title, body, source_url, fetched_at)
    VALUES (${id}, ${trip_id}, ${b.line_name ?? null}, ${b.severity ?? 'info'}, ${b.title ?? null},
            ${b.body ?? null}, ${b.source_url ?? null}, ${null})`;
  const [a] = (await sql`SELECT * FROM service_alerts WHERE id=${id}`) as ServiceAlert[];
  return c.json(a);
});

app.delete('/api/service-alerts/:id', async (c) => {
  await sql`DELETE FROM service_alerts WHERE id=${c.req.param('id')}`;
  return c.json({ ok: true });
});

app.post('/api/trips/:id/service-alerts/refresh', async (c) => {
  return c.json(
    {
      error: '運行情報の自動取得データ源が未設定です。手入力で登録してください。',
      hint: '各社運行情報 API または ODPT(train-information) を refresh プロバイダとして配線すると有効になります。',
    },
    501,
  );
});

export default app;
