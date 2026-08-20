// 日割りの見出し付け。移動と滞在の計算は決定的に済ませてあり、
// LLM は「その日が何の日か」を言葉にするだけ (順番や所要は動かさない)。
// 失敗しても日割りは成立するため、呼び側で warning にして既定タイトルのまま返す。

import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { config } from '../config.js';
import type { PlanDay, SeasonalHint } from './types.js';

const MAX_TITLE_LENGTH = 16;
const MAX_NOTE_LENGTH = 60;

export interface PlanTitle {
  day_index: number;
  title: string;
  note: string | null;
}

function clamp(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, max).join('');
}

/** 各日の見出しと一言メモを求める。失敗時は throw する。 */
export async function titlePlanDays(
  tripTitle: string,
  days: PlanDay[],
  hints: SeasonalHint[],
): Promise<PlanTitle[]> {
  const outline = days.map((d) => {
    const visits = d.items.filter((i) => i.kind === 'visit').map((i) => i.label);
    return `${d.day_index}: ${d.date ?? '日付未定'} / ${visits.length > 0 ? visits.join(' → ') : '予定なし'}`;
  });

  const raw = await complete({
    model: config.llm.summaryModel,
    system: '旅程に見出しを付けます。必ず JSON オブジェクト 1 個だけを返してください。行き先を勝手に増やさないでください。',
    user: [
      `旅の名前: ${tripTitle}`,
      `季節のヒント: ${hints.length > 0 ? hints.map((h) => `${h.label}(${h.detail})`).join(' / ') : 'なし'}`,
      '各日の行き先:',
      ...outline,
      '',
      `days: 各日について {"day_index":番号,"title":"${MAX_TITLE_LENGTH}文字以内の見出し","note":"${MAX_NOTE_LENGTH}文字以内の一言"}。`,
      'title はその日の行き先から付けてください。note はその日に気をつけることを 1 つだけ書いてください。',
      '出力例: {"days":[{"day_index":0,"title":"港町を歩く","note":"夕方は風が強いので上着を。"}]}',
    ].join('\n'),
  });

  const parsed = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
  if (!Array.isArray(parsed.days)) return [];
  const titles: PlanTitle[] = [];
  for (const entry of parsed.days) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const dayIndex = typeof row.day_index === 'number' ? row.day_index : null;
    const title = clamp(row.title, MAX_TITLE_LENGTH);
    if (dayIndex == null || !title) continue;
    titles.push({ day_index: dayIndex, title, note: clamp(row.note, MAX_NOTE_LENGTH) });
  }
  return titles;
}
