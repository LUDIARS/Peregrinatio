// 拠点サマリー自動生成のバックグラウンド走査。
//   config.baseSummary.intervalMs ごとに 1 回、要約候補の拠点を最大 1 件選んで
//   generateBaseSummary を呼ぶ。多重起動防止・unref()・例外握り潰しでプロセスを巻き込まない。
// 起動は index.ts の startBaseSummaryQueue() (config.baseSummary.enabled 時) から。

import { sql } from '../db/index.js';
import { config } from '../config.js';
import { generateBaseSummary } from './generate.js';

let started = false;

/** 走査 1 回分。候補の拠点を 1 件だけ要約する。例外はログして握り潰す。 */
async function scanOnce(): Promise<void> {
  // 条件:
  //   - is_base=1 の place を持つ
  //   - その旅の紐付け場所数 >= minPlaces
  //   - base place.summary が空 (= 未生成。ユーザ編集済みなら触らない)
  // を満たす拠点を 1 件選ぶ。
  const candidates = (await sql`
    SELECT p.id AS id
    FROM places p
    JOIN trip_places tp ON tp.place_id = p.id AND tp.is_base = 1
    WHERE (p.summary IS NULL OR TRIM(p.summary) = '')
      AND (
        SELECT COUNT(*) FROM trip_places tp2 WHERE tp2.trip_id = tp.trip_id
      ) >= ${config.baseSummary.minPlaces}
    LIMIT 1`) as { id: string }[];

  if (candidates.length === 0) return;
  const target = candidates[0]!;

  try {
    const res = await generateBaseSummary(target.id);
    if (res.ok) console.log(`[base-summary] 自動生成しました (place=${target.id})`);
  } catch (err) {
    // LLM backend 未準備等。静かに次回へ。
    console.error(`[base-summary] 自動生成に失敗 (place=${target.id}):`, err);
  }
}

/**
 * 拠点サマリー自動生成の定期走査を開始する (1 プロセス 1 回のみ)。
 * setInterval を 1 つ張り、unref() でプロセス終了を妨げない。
 */
export function startBaseSummaryQueue(): void {
  if (started) return;
  started = true;

  const timer = setInterval(() => {
    void scanOnce().catch((err) => {
      console.error('[base-summary] 走査でエラー:', err);
    });
  }, config.baseSummary.intervalMs);
  timer.unref();

  console.log(`[base-summary] バックグラウンド走査を開始 (間隔 ${config.baseSummary.intervalMs}ms / 最小場所数 ${config.baseSummary.minPlaces})`);
}
