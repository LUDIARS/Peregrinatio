// 提案 API。荷物・季節・プランの 3 提案と、その採用。
// 提案エンドポイントは DB を書き換えない。書き込みは /adopt だけが行う。

import { Hono } from 'hono';
import { loadTripContext } from '../suggest/trip-context.js';
import { suggestPacking } from '../suggest/packing.js';
import { adoptPacking } from '../suggest/packing-adopt.js';
import { parsePackingAdoptInput } from '../suggest/packing-adopt-input.js';
import { planDates, suggestPlan } from '../suggest/plan.js';
import { adoptPlan } from '../suggest/plan-adopt.js';
import { parsePlanAdoptDays } from '../suggest/plan-adopt-input.js';
import { normalizePlanInput } from '../suggest/plan-input.js';
import { climateWindowsOfTrip, seasonalHints, seasonLabelOfTrip } from '../suggest/season.js';

const app = new Hono();

/** LLM 併用フラグ。既定は使う (提案の質を優先)。明示 false でルールのみ。 */
function useLlmOf(body: Record<string, unknown>): boolean {
  return body.use_llm !== false;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => ({}));
  return (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
}

/** POST /api/trips/:id/packing/suggest — 設備と季節から持ち物を提案する (DB は変えない)。 */
app.post('/api/trips/:id/packing/suggest', async (c) => {
  const ctx = await loadTripContext(c.req.param('id'));
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);
  const body = await readBody(c);
  return c.json(await suggestPacking(ctx, { useLlm: useLlmOf(body) }));
});

/** POST /api/trips/:id/packing/adopt — 選ばれた持ち物を持ち物リストへ入れる。 */
app.post('/api/trips/:id/packing/adopt', async (c) => {
  const tripId = c.req.param('id');
  const ctx = await loadTripContext(tripId);
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);

  const body = await readBody(c);
  const input = parsePackingAdoptInput(body);
  if (!input.ok) return c.json({ error: input.error }, 400);
  return c.json(await adoptPacking(tripId, input.items, input.removeItemIds));
});

/** GET /api/trips/:id/season-hints — 季節柄の見どころ・注意点だけを返す。 */
app.get('/api/trips/:id/season-hints', async (c) => {
  const ctx = await loadTripContext(c.req.param('id'));
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);
  const windows = climateWindowsOfTrip(ctx.trip.start_date, ctx.trip.end_date);
  return c.json({
    season_label: seasonLabelOfTrip(ctx.trip.start_date, ctx.trip.end_date),
    hints: seasonalHints(windows),
  });
});

/** POST /api/trips/:id/plan/suggest — 交通手段を軸に日割り案を作る (DB は変えない)。 */
app.post('/api/trips/:id/plan/suggest', async (c) => {
  const ctx = await loadTripContext(c.req.param('id'));
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);
  const body = await readBody(c);
  return c.json(await suggestPlan(ctx, normalizePlanInput(body), { useLlm: useLlmOf(body) }));
});

/** POST /api/trips/:id/plan/adopt — 案を旅に反映する (対象の日を上書きする)。 */
app.post('/api/trips/:id/plan/adopt', async (c) => {
  const tripId = c.req.param('id');
  const ctx = await loadTripContext(tripId);
  if (!ctx) return c.json({ error: '旅が見つかりません' }, 404);

  const body = await readBody(c);
  if (body.confirm !== true) {
    return c.json({ error: '採用は既存の予定を上書きします。confirm=true を付けてください' }, 400);
  }
  const input = parsePlanAdoptDays(body.days, planDates(ctx));
  if (!input.ok) return c.json({ error: input.error }, 400);
  return c.json(await adoptPlan(tripId, input.days));
});

export default app;
