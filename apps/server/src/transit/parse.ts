// LLM 出力 (便/運行情報の JSON) を抽出型へ変換する純関数群。IO は持たない (テスト対象)。
// crawl-llm プロバイダがクロール本文を LLM に渡して得た応答をここで構造化する。

import { extractJsonBlock } from '@peregrinatio/llm';
import type { AlertExtract, DepartureExtract } from './provider.js';

const VALID_SEVERITY = new Set(['normal', 'info', 'warning', 'suspended']);

/** 'HH:MM' らしき文字列なら正規化 (0-47 時を許容: 深夜便表記)。それ以外は null。 */
export function normTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** 文字列に整形 (trim)。空/非文字列は null。 */
export function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** severity を既知集合へ丸める。未知/未指定は 'info'。 */
function normSeverity(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return VALID_SEVERITY.has(t) ? t : 'info';
}

/** JSON の便配列 ({ "departures": [...] } または素の配列) を取り出す。 */
function pickArray(json: unknown, key: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const v = (json as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** LLM の便抽出応答 → DepartureExtract[]。時刻が全く無い行は捨てる。 */
export function parseDepartures(raw: string): DepartureExtract[] {
  const json = JSON.parse(extractJsonBlock(raw)) as unknown;
  const arr = pickArray(json, 'departures');
  const out: DepartureExtract[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const depart = normTime(r.depart_time ?? r.depart ?? r.departure);
    const arrive = normTime(r.arrive_time ?? r.arrive ?? r.arrival);
    if (!depart && !arrive) continue;
    out.push({
      depart_time: depart,
      arrive_time: arrive,
      train_name: asText(r.train_name ?? r.train ?? r.name),
      platform: asText(r.platform ?? r.track),
      fare_text: asText(r.fare_text ?? r.fare),
      note: asText(r.note ?? r.remark),
    });
  }
  return out;
}

/** LLM の運行情報抽出応答 → AlertExtract[]。title/body のどちらも無い行は捨てる。 */
export function parseAlerts(raw: string): AlertExtract[] {
  const json = JSON.parse(extractJsonBlock(raw)) as unknown;
  const arr = pickArray(json, 'alerts');
  const out: AlertExtract[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const title = asText(r.title ?? r.name);
    const body = asText(r.body ?? r.detail ?? r.description);
    if (!title && !body) continue;
    out.push({
      line_name: asText(r.line_name ?? r.line),
      severity: normSeverity(r.severity ?? r.level),
      title,
      body,
      source_url: asText(r.source_url ?? r.url),
    });
  }
  return out;
}
