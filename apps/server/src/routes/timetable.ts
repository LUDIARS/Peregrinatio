// 時刻表 / 運行情報。データ源 (NAVITIME/駅すぱあと/ODPT 等) は未配線。
// 手入力で end-to-end 動く骨組み + fetch/refresh の差し替え口 (既定は未対応を明示)。
//   GET/POST   /api/trips/:id/timetables
//   DELETE     /api/timetables/:id
//   GET/POST   /api/timetables/:id/departures
//   DELETE     /api/departures/:id
//   POST       /api/timetables/:id/fetch              (差し替え可能・既定 501)
//   GET/POST   /api/trips/:id/service-alerts
//   POST       /api/trips/:id/service-alerts/refresh  (差し替え可能・既定 501)

import type { Context } from 'hono';
import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { pick } from '../lib/http.js';
import { config } from '../config.js';
import { defaultProviderKind, resolveProvider } from '../transit/index.js';
import { PROVIDER_KINDS, ProviderFetchError, ProviderInputError, ProviderUnavailableError } from '../transit/provider.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TimetableKind } from '../types.js';

const app = new Hono();

const VALID_KINDS: readonly TimetableKind[] = ['shinkansen', 'bus', 'train'];

// 利用可能な取得プロバイダを返す。crawl-llm は常時、ekispert は契約キー設定時のみ。
app.get('/api/transit/config', (c) => {
  const ekispertEnabled = Boolean(config.transit.ekispertKey);
  const providers = PROVIDER_KINDS.filter((k) => k !== 'ekispert' || ekispertEnabled);
  return c.json({ providers, default: defaultProviderKind(config), ekispertEnabled });
});

/** プロバイダ例外 → HTTP。未配線=501 / 入力不足=400 / 取得失敗=502。想定外は握り潰さず再 throw。 */
function providerErrorResponse(c: Context, e: unknown): Response {
  if (e instanceof ProviderUnavailableError) return c.json({ error: e.message, hint: e.hint }, 501);
  if (e instanceof ProviderInputError) return c.json({ error: e.message, hint: e.hint }, 400);
  if (e instanceof ProviderFetchError) return c.json({ error: e.message }, 502);
  throw e;
}

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

// ── 便の自動取得 (provider: 既定 crawl-llm / ekispert) ─────────────────────
// body: { provider?: 'crawl-llm'|'ekispert', url?: string, date?: 'YYYY-MM-DD' }
//   crawl-llm: url のページをクロール→LLM 抽出。ekispert: timetable の from/to 駅で経路探索。
app.post('/api/timetables/:id/fetch', async (c) => {
  const id = c.req.param('id');
  const [tt] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  if (!tt) return c.json({ error: 'timetable not found' }, 404);

  const b = (await c.req.json().catch(() => ({}))) as { provider?: string; url?: string; date?: string };

  try {
    const provider = resolveProvider(b.provider, config);
    if (!provider.supportsDepartures) {
      return c.json({ error: `${provider.kind} は時刻表の自動取得に未対応です` }, 501);
    }
    const extracted = await provider.fetchDepartures({
      kind: tt.kind,
      line_name: tt.line_name,
      from_station: tt.from_station,
      to_station: tt.to_station,
      url: b.url ?? null,
      date: b.date ?? null,
    });
    if (extracted.length === 0) {
      return c.json({ error: 'ページ/応答から便を抽出できませんでした (手入力で追加してください)' }, 422);
    }

    // 既存便の後ろに連番で追加する (手入力分を上書きしない)。
    const [cnt] = (await sql`SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${id}`) as { n: number }[];
    let order = cnt?.n ?? 0;
    for (const d of extracted) {
      await sql`INSERT INTO timetable_departures
        (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
        VALUES (${newId()}, ${id}, ${d.depart_time}, ${d.arrive_time}, ${d.train_name},
                ${d.platform}, ${d.fare_text}, ${d.note}, ${order++})`;
    }
    const rows = (await sql`
      SELECT * FROM timetable_departures WHERE timetable_id=${id}
      ORDER BY order_index, depart_time`) as TimetableDeparture[];
    return c.json({ provider: provider.kind, added: extracted.length, departures: rows });
  } catch (e) {
    return providerErrorResponse(c, e);
  }
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

// body: { provider?: 'crawl-llm'|'ekispert', url?: string, line_name?: string }
//   crawl-llm: url の運行情報ページをクロール→LLM 抽出。ekispert は運行情報未対応 (501)。
app.post('/api/trips/:id/service-alerts/refresh', async (c) => {
  const tripId = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as { provider?: string; url?: string; line_name?: string };

  try {
    const provider = resolveProvider(b.provider, config);
    if (!provider.supportsAlerts) {
      return c.json(
        {
          error: `${provider.kind} は運行情報の自動更新に未対応です`,
          hint: 'crawl-llm (url 指定) を使うか、各社運行情報 API を配線してください。',
        },
        501,
      );
    }
    const alerts = await provider.fetchAlerts({ line_name: b.line_name ?? null, url: b.url ?? null });
    if (alerts.length === 0) {
      return c.json({ error: 'ページ/応答から運行情報を抽出できませんでした (手入力で登録してください)' }, 422);
    }

    const fetchedAt = nowIso();
    for (const a of alerts) {
      await sql`INSERT INTO service_alerts (id, trip_id, line_name, severity, title, body, source_url, fetched_at)
        VALUES (${newId()}, ${tripId}, ${a.line_name}, ${a.severity}, ${a.title}, ${a.body}, ${a.source_url}, ${fetchedAt})`;
    }
    const rows = (await sql`
      SELECT * FROM service_alerts WHERE trip_id=${tripId} ORDER BY created_at DESC`) as ServiceAlert[];
    return c.json({ provider: provider.kind, added: alerts.length, alerts: rows });
  } catch (e) {
    return providerErrorResponse(c, e);
  }
});

export default app;
