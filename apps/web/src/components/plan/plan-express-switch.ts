// プラン案の往復便を別の候補へ差し替える (純関数)。
// サーバが候補ごとに作った行の組 (PlanExpressChoice.items) で、同じ方向の行をまるごと置き換える。
// 前後の予定の時刻は動かさないので、拠点着が大きく変わるときは案を作り直してもらう。
// @implements SPEC-EXPRESS-PLAN

import type { PlanDay, PlanSuggestResult } from '../../types.js';

export function switchExpressChoice(
  result: PlanSuggestResult,
  direction: 'outbound' | 'inbound',
  index: number,
): PlanSuggestResult {
  const express = result.express;
  if (!express) return result;
  const choices = direction === 'outbound' ? express.outbound : express.inbound;
  const choice = choices[index];
  if (!choice) return result;

  const days: PlanDay[] = result.days.map((day) => {
    const at = day.items.findIndex((i) => i.express_ref?.direction === direction);
    if (at < 0) return day;
    const removed = day.items.filter((i) => i.express_ref?.direction === direction);
    const kept = day.items.filter((i) => i.express_ref?.direction !== direction);
    const items = [...kept.slice(0, at), ...choice.items, ...kept.slice(at)];
    const delta = choice.items.reduce((s, i) => s + (i.duration_sec ?? 0), 0)
      - removed.reduce((s, i) => s + (i.duration_sec ?? 0), 0);
    return { ...day, items, travel_sec: Math.max(0, day.travel_sec + delta) };
  });

  return {
    ...result,
    days,
    express: direction === 'outbound'
      ? { ...express, selected_outbound: index }
      : { ...express, selected_inbound: index },
  };
}
