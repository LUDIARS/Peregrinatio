// ページ本文 → 施設情報 (summary / category / address) の LLM 抽出。
// @peregrinatio/llm の complete で JSON 指示し、堅牢に parse する。
// parse 失敗は握り潰さず例外にする (空 summary fallback はしない)。

import { complete, extractJsonBlock } from '@peregrinatio/llm';

export interface PlaceInfo {
  summary: string;
  category?: string;
  address?: string;
}

export const EXTRACT_INSTRUCTION = `
あなたは旅行者のために、施設/店舗/観光地の Web ページから基礎情報を抽出するアシスタントです。
与えられたページ本文から、しおりに載せる要約と分類・住所を JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・後置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "summary": "施設の概要 (日本語 120 字以内。何が楽しめる/食べられる場所か、特徴を簡潔に)",
  "category": "分類 (例: カフェ / 神社 / 美術館 / ホテル / 展望台。1 語〜短句。不明なら空文字)",
  "address": "所在地 (郵便番号や都道府県から始まる住所。本文に無ければ空文字)"
}

ルール:
- 本文に無い情報は推測で埋めず空文字にする。
- summary は誇張せず事実ベースで簡潔に。営業時間や料金が分かれば一言添えてよい。
- address はジオコーディングに使うため、できるだけ完全な住所表記にする。
`.trim();

/** LLM の出力テキストを PlaceInfo に parse する (parse 失敗は例外)。 */
export function parsePlaceExtraction(text: string): PlaceInfo {
  const obj = JSON.parse(extractJsonBlock(text)) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const summary = s(obj['summary']);
  const category = s(obj['category']);
  const address = s(obj['address']);
  return {
    summary,
    ...(category ? { category } : {}),
    ...(address ? { address } : {}),
  };
}

/**
 * ページ本文から施設情報を抽出する。
 * @param pageText htmlToText 済みの本文
 * @param name place 名 (抽出のヒント)
 * @param model 任意。未指定なら complete の既定 (haiku)。
 */
export async function extractPlaceInfo(
  pageText: string,
  name: string,
  model?: string,
): Promise<PlaceInfo> {
  const user = [
    `施設名 (ヒント): ${name || '(不明)'}`,
    '',
    '## ページ本文',
    pageText,
  ].join('\n');

  const out = await complete({
    system: EXTRACT_INSTRUCTION,
    user,
    ...(model ? { model } : {}),
  });
  return parsePlaceExtraction(out);
}
