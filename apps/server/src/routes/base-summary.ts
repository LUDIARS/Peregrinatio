// 拠点サマリーの手動トリガ。
//   POST /api/places/:id/summarize-base  → generateBaseSummary を即実行し更新後の place を返す。
// バックグラウンド走査 (base-summary/queue.ts) と同じ生成ロジックを共有する。

import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { generateBaseSummary } from '../base-summary/generate.js';
import type { Place } from '../types.js';

const app = new Hono();

/** POST /api/places/:id/summarize-base — この場所を拠点として周辺要約を即生成する。 */
app.post('/api/places/:id/summarize-base', async (c) => {
  const id = c.req.param('id');
  const [place] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];
  if (!place) return c.json({ error: 'place not found' }, 404);

  // この場所が拠点になっている旅があるか先に確認 (材料不足と区別したメッセージのため)。
  const [membership] = (await sql`
    SELECT trip_id FROM trip_places
    WHERE place_id=${id} AND is_base=1 LIMIT 1`) as { trip_id: string }[];
  if (!membership) {
    return c.json({ error: 'この場所を拠点 (is_base) とする旅がありません' }, 400);
  }

  const res = await generateBaseSummary(id);
  const [updated] = (await sql`SELECT * FROM places WHERE id=${id}`) as Place[];

  if (!res.ok) {
    // 旅はあるが周辺の材料が足りない/生成に失敗。place は現状のまま返す。
    return c.json({ place: updated, warning: '周辺情報が不足しているか、要約の生成に失敗しました' });
  }
  return c.json(updated);
});

export default app;
