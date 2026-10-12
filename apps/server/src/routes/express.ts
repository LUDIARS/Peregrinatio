// 新幹線・特急の時刻表ライブラリ (旅をまたいで共有) と、旅の往復便の提案。
//   GET    /api/express/lines                       路線一覧
//   GET    /api/express/lines/:id                   駅・列車・時刻
//   DELETE /api/express/lines/:id
//   PATCH  /api/express/lines/:id/stations/:seq     駅座標の手修正
//   GET    /api/express/lines/:id/segments          乗車駅→降車駅で乗れる便 (しおりの「移動を追加」)
//   POST   /api/express/import/preview              取り込みプレビュー (保存しない)
//   POST   /api/express/import                      プレビューと同じ形を保存 (単一トランザクション)
//   POST   /api/trips/:id/express/suggest           往路・復路の便の提案 (DB は変えない)
//   POST   /api/trips/:id/express/adopt             便を旅の区間ボードへ写す
// @implements SPEC-EXPRESS-LIBRARY
// @implements SPEC-EXPRESS-IMPORT
// @implements SPEC-EXPRESS-SUGGEST
// @implements SPEC-EXPRESS-ITINERARY

import type { Context } from 'hono';
import { Hono } from 'hono';
import { config } from '../config.js';
import { copyTrainToBoard } from '../express/board-copy.js';
import { buildPreview, parsePreviewRequest } from '../express/import-preview.js';
import { validateImportPayload } from '../express/import-validate.js';
import {
  deleteExpressLine,
  getExpressLine,
  getExpressLineDetail,
  listExpressLines,
  listTrains,
  saveExpressImport,
  updateStationCoords,
} from '../express/repository.js';
import { suggestExpressForTrip } from '../express/suggest.js';
import { clockToMinutes } from '../express/time-cell.js';
import { trainSegments } from '../express/train-select.js';
import { parseHhmm } from '../suggest/plan-time.js';
import { loadTripContext } from '../suggest/trip-context.js';
import { ProviderFetchError, ProviderInputError } from '../transit/provider.js';

const app = new Hono();

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => ({}));
  return (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
}

function intParam(value: string | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

app.get('/api/express/lines', async (c) => c.json(await listExpressLines()));

app.get('/api/express/lines/:id', async (c) => {
  const detail = await getExpressLineDetail(c.req.param('id'));
  if (!detail) return c.json({ error: '路線が見つかりません' }, 404);
  return c.json(detail);
});

app.delete('/api/express/lines/:id', async (c) => {
  await deleteExpressLine(c.req.param('id'));
  return c.json({ ok: true });
});

app.patch('/api/express/lines/:id/stations/:seq', async (c) => {
  const seq = intParam(c.req.param('seq'));
  if (seq == null) return c.json({ error: 'seq が不正です' }, 400);
  const b = await readBody(c);
  const lat = b.lat === null ? null : typeof b.lat === 'number' && Math.abs(b.lat) <= 90 ? b.lat : undefined;
  const lng = b.lng === null ? null : typeof b.lng === 'number' && Math.abs(b.lng) <= 180 ? b.lng : undefined;
  if (lat === undefined || lng === undefined || (lat === null) !== (lng === null)) {
    return c.json({ error: 'lat / lng は数値の組 (消すときは両方 null) で指定してください' }, 400);
  }
  const station = await updateStationCoords(c.req.param('id'), seq, lat, lng);
  if (!station) return c.json({ error: '駅が見つかりません' }, 404);
  return c.json(station);
});

// ?from_seq=&to_seq=&date=YYYY-MM-DD&after=HH:MM
app.get('/api/express/lines/:id/segments', async (c) => {
  const lineId = c.req.param('id');
  const fromSeq = intParam(c.req.query('from_seq'));
  const toSeq = intParam(c.req.query('to_seq'));
  if (fromSeq == null || toSeq == null || fromSeq === toSeq) {
    return c.json({ error: 'from_seq と to_seq (別の駅) を指定してください' }, 400);
  }
  if (!(await getExpressLine(lineId))) return c.json({ error: '路線が見つかりません' }, 404);
  const date = c.req.query('date') ?? '';
  const after = parseHhmm(c.req.query('after') ?? null);
  const segments = trainSegments(await listTrains(lineId), fromSeq, toSeq, date)
    .filter((s) => after == null || s.depart_min >= after);
  return c.json(segments.map((s) => ({
    train_id: s.train.id,
    train_name: s.train.train_name,
    service_note: s.train.service_note,
    verdict: s.verdict,
    depart_time: s.depart_time,
    arrive_time: s.arrive_time,
  })));
});

app.post('/api/express/import/preview', async (c) => {
  const parsed = parsePreviewRequest(await readBody(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  try {
    const result = await buildPreview(parsed.req, config);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result.payload);
  } catch (e) {
    if (e instanceof ProviderInputError) return c.json({ error: e.message, hint: e.hint }, 400);
    if (e instanceof ProviderFetchError) return c.json({ error: e.message }, 502);
    throw e;
  }
});

app.post('/api/express/import', async (c) => {
  const body = await readBody(c);
  const result = validateImportPayload(body);
  if (!result.ok) return c.json({ error: result.error }, 400);
  const replace = typeof body.replace_line_id === 'string' && body.replace_line_id ? body.replace_line_id : null;
  if (replace && !(await getExpressLine(replace))) return c.json({ error: '置き換え対象の路線が見つかりません' }, 404);
  const lineId = await saveExpressImport(result.payload, replace);
  return c.json({ line: await getExpressLineDetail(lineId), warnings: result.payload.warnings });
});

// body: { inbound_leave_time?: 'HH:MM' }
app.post('/api/trips/:id/express/suggest', async (c) => {
  const ctx = await loadTripContext(c.req.param('id'));
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);
  const b = await readBody(c);
  const leave = typeof b.inbound_leave_time === 'string' ? clockToMinutes(b.inbound_leave_time) : null;
  return c.json(await suggestExpressForTrip(ctx, { inboundLeaveMin: leave }));
});

// body: { train_id, from_seq, to_seq }
app.post('/api/trips/:id/express/adopt', async (c) => {
  const b = await readBody(c);
  const fromSeq = typeof b.from_seq === 'number' && Number.isInteger(b.from_seq) ? b.from_seq : null;
  const toSeq = typeof b.to_seq === 'number' && Number.isInteger(b.to_seq) ? b.to_seq : null;
  if (typeof b.train_id !== 'string' || fromSeq == null || toSeq == null) {
    return c.json({ error: 'train_id / from_seq / to_seq を指定してください' }, 400);
  }
  const r = await copyTrainToBoard(c.req.param('id'), b.train_id, fromSeq, toSeq);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json({ timetable: r.timetable, departure: r.departure });
});

export default app;
