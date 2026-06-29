// Google マップの公共交通(乗換)経路の検索結果テキストを LLM (claude CLI) で構造化する。
// Routes/Directions API が日本の transit を返さないための暫定手段 (将来 ODPT に置換)。
// 抽出失敗は silent fallback せず、呼び出し側で「解析できなかった」を surface する。

import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { config } from '../config.js';

export interface ParsedTransit {
  duration_sec: number | null;
  fare_text: string | null;
  note: string | null; // 路線/乗換の 1 行要約
}

/** "¥1,234" 形式に整える。 */
function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

/**
 * Google マップの乗換結果テキストから 所要時間 / 運賃 / 路線・乗換要約 を抽出する。
 * @throws text が空のとき / LLM 呼び出しに失敗したとき
 */
export async function parseGmapsTransit(text: string): Promise<ParsedTransit> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('解析するテキストが空です (Google マップの経路結果を貼り付けてください)');

  const system = [
    'あなたは経路情報の抽出器です。入力は Google マップの公共交通(乗換)経路の検索結果テキストです。',
    '所要時間・運賃・利用路線と乗換を読み取り、JSON オブジェクト 1 個のみを出力してください。',
    '形式: { "duration_min": 所要時間の分(整数, 不明なら null), "fare_yen": 運賃の円(整数, 不明なら null), "summary": "路線と乗換の要約(日本語1行, 例 \\"JR山手線→東京メトロ丸ノ内線(2駅) 乗換1回\\")" }',
    'コードブロックや説明文は付けず、JSON だけを返してください。',
  ].join('\n');

  const raw = await complete({ system, user: trimmed, model: config.llm.summaryModel });

  let duration_sec: number | null = null;
  let fare_text: string | null = null;
  let note: string | null = null;
  try {
    const o = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
    if (typeof o['duration_min'] === 'number' && Number.isFinite(o['duration_min'])) {
      duration_sec = Math.round((o['duration_min'] as number) * 60);
    }
    if (typeof o['fare_yen'] === 'number' && Number.isFinite(o['fare_yen'])) {
      fare_text = formatYen(o['fare_yen'] as number);
    }
    if (typeof o['summary'] === 'string' && o['summary'].trim()) {
      note = o['summary'].trim();
    }
  } catch {
    // JSON 抽出に失敗。せめて生応答を要約 note として残す (空よりは手掛かりになる)。
    note = raw.trim().slice(0, 200) || null;
  }

  return { duration_sec, fare_text, note };
}
