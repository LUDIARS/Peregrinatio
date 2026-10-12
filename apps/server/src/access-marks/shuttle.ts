// 🚌 シャトルバスありの判定 (純関数)。
// 施設サマリーのクロール→LLM が抽出した結果があればそれを優先し (無いと言えば付けない)、
// 無ければ場所の要約・メモ・設備候補の本文から送迎系の語を探して根拠の抜粋を付ける。
// @implements SPEC-ACCESS-SHUTTLE

import type { CandidateTexts, ShuttleBusMark } from './types.js';

export const SHUTTLE_KEYWORDS = ['送迎バス', 'シャトルバス', '無料バス', '巡回バス', '送迎', 'シャトル'] as const;
const EXCERPT_RADIUS = 40;

/** クロール→LLM の抽出結果 (place_access_cache の 'shuttle_llm')。 */
export interface ShuttleExtraction {
  available: boolean;
  evidence: string | null;
  source_url: string | null;
}

/** 語の前後 40 文字を抜き出す。 */
export function excerptAround(text: string, index: number, length: number): string {
  const chars = Array.from(text);
  // index は UTF-16 単位なので、文字単位の位置に直してから切る。
  const charIndex = Array.from(text.slice(0, index)).length;
  const charLen = Array.from(text.slice(index, index + length)).length;
  const start = Math.max(0, charIndex - EXCERPT_RADIUS);
  const end = Math.min(chars.length, charIndex + charLen + EXCERPT_RADIUS);
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('').replace(/\s+/g, ' ').trim()}${end < chars.length ? '…' : ''}`;
}

/** 「送迎なし」「送迎は行っておりません」のような否定は印の根拠にしない。 */
const NEGATION_AFTER = /^.{0,8}?(なし|無し|ありません|ございません|行っておりません|しておりません|不可|休止|廃止)/;

function findKeyword(text: string): { index: number; length: number } | null {
  for (const keyword of SHUTTLE_KEYWORDS) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(keyword, from);
      if (index < 0) break;
      if (!NEGATION_AFTER.test(text.slice(index + keyword.length))) return { index, length: keyword.length };
      from = index + keyword.length;
    }
  }
  return null;
}

export function judgeShuttleBus(texts: CandidateTexts | null, extraction: ShuttleExtraction | null): ShuttleBusMark | null {
  if (extraction) {
    if (!extraction.available) return null;
    return {
      evidence: extraction.evidence?.trim() || '施設サイトに送迎・シャトルバスの記載があります',
      source: 'crawl',
      source_url: extraction.source_url,
    };
  }
  if (!texts) return null;
  const sources: Array<{ source: ShuttleBusMark['source']; text: string | null }> = [
    { source: 'summary', text: texts.summary },
    { source: 'notes', text: texts.notes },
    ...texts.facilities.map((name) => ({ source: 'facility' as const, text: name })),
  ];
  for (const s of sources) {
    if (!s.text) continue;
    const hit = findKeyword(s.text);
    if (hit) return { evidence: excerptAround(s.text, hit.index, hit.length), source: s.source, source_url: null };
  }
  return null;
}
