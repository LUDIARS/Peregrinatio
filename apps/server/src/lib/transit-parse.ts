// Google マップの公共交通(乗換)経路の検索結果テキストを LLM (claude CLI) で構造化する。
// Google マップは複数の経路候補を返すので、候補を配列で抽出してユーザに選ばせる。
// Routes/Directions API が日本の transit を返さないための暫定手段 (将来 ODPT に置換)。

import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { config } from '../config.js';

/** 1 つの経路候補。 */
export interface TransitOption {
  depart_time: string | null;   // 出発時刻 'HH:MM'
  arrive_time: string | null;   // 到着時刻 'HH:MM'
  duration_min: number | null;  // 所要(分)
  fare_yen: number | null;      // 運賃(円)
  interval_min: number | null;  // 運行間隔(分, 分かれば)
  summary: string;              // 路線/乗換の要約 (1 行)
}

/** 区間に確定保存する transit 情報 (storeTransitOnLeg 用)。 */
export interface ParsedTransit {
  duration_sec: number | null;
  fare_text: string | null;
  depart_time: string | null;
  arrive_time: string | null;
  note: string | null;
}

/** "¥1,234" に整える。 */
export function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

/** 選んだ候補を、区間に保存する形へ変換する。 */
export function optionToParsed(o: TransitOption): ParsedTransit {
  const times = o.depart_time && o.arrive_time ? `${o.depart_time}→${o.arrive_time} ` : '';
  const interval = o.interval_min != null ? ` (約${o.interval_min}分間隔)` : '';
  const note = `${times}${o.summary}${interval}`.trim() || null;
  return {
    duration_sec: o.duration_min != null ? Math.round(o.duration_min * 60) : null,
    fare_text: o.fare_yen != null ? formatYen(o.fare_yen) : null,
    depart_time: o.depart_time,
    arrive_time: o.arrive_time,
    note,
  };
}

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function toTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /(\d{1,2}):(\d{2})/.exec(v.trim());
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/**
 * Google マップの乗換結果テキストから経路候補の配列を抽出する。
 * @throws text が空 / 候補が 1 件も取れなかったとき
 */
export async function parseGmapsTransitOptions(text: string): Promise<TransitOption[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('解析するテキストが空です (Google マップの経路結果を貼り付けてください)');

  const system = [
    'あなたは経路情報の抽出器です。入力は Google マップの公共交通(乗換)経路の検索結果テキストで、複数の経路候補が含まれます。',
    '各候補について 出発時刻・到着時刻・所要時間・運賃・運行間隔・利用路線と乗換 を読み取り、JSON 配列のみを出力してください。',
    '形式: [{ "depart": "HH:MM"|null, "arrive": "HH:MM"|null, "duration_min": 整数|null, "fare_yen": 整数|null, "interval_min": 整数|null, "summary": "路線と乗換の要約(日本語1行, 例 \\"中央線(東京→新宿)\\")" }, ...]',
    '候補は入力の出現順。コードブロックや説明文は付けず、JSON 配列だけを返してください。',
  ].join('\n');

  const raw = await complete({ system, user: trimmed, model: config.llm.summaryModel });

  let arr: unknown;
  try {
    arr = JSON.parse(extractJsonBlock(raw));
  } catch {
    throw new Error('経路候補を解析できませんでした (Google マップの結果テキストを見直してください)');
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('経路候補が見つかりませんでした');
  }

  const options: TransitOption[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const summary = typeof o['summary'] === 'string' ? o['summary'].trim() : '';
    options.push({
      depart_time: toTime(o['depart']),
      arrive_time: toTime(o['arrive']),
      duration_min: toNum(o['duration_min']),
      fare_yen: toNum(o['fare_yen']),
      interval_min: toNum(o['interval_min']),
      summary: summary || '経路',
    });
  }
  if (options.length === 0) throw new Error('経路候補が見つかりませんでした');
  return options;
}
