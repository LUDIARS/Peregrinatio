import { complete, extractJsonBlock } from '@peregrinatio/llm';
import { config } from '../config.js';

export const MAX_BASE_NAME_LENGTH = 8;
const MAX_FACILITY_NAME_LENGTH = 40;
const MAX_FACILITIES = 20;

export interface PlaceForFacilitySuggestion {
  name: string;
  category: string | null;
  summary: string | null;
  notes: string | null;
  is_base: number;
}

export interface BaseFacilitySuggestion {
  baseName: string | null;
  facilities: string[];
}

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function defaultBaseName(name: string): string {
  return Array.from(name.trim()).slice(0, MAX_BASE_NAME_LENGTH).join('');
}

export function isFacilityListingPlace(place: Pick<PlaceForFacilitySuggestion, 'name' | 'category' | 'is_base'>): boolean {
  if (place.is_base === 1) return true;
  return /(複合|モール|商業施設|テーマパーク|リゾート|ホテル|旅館|宿泊|道の駅|サービスエリア|駅ビル|アウトレット|shopping_mall|department_store|amusement_park|resort|hotel|lodging)/i
    .test(`${place.category ?? ''} ${place.name}`);
}

function normalizeBaseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, MAX_BASE_NAME_LENGTH).join('');
}

function normalizeFacilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = Array.from(item.trim()).slice(0, MAX_FACILITY_NAME_LENGTH).join('');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= MAX_FACILITIES) break;
  }
  return result;
}

export async function suggestBaseFacilities(place: PlaceForFacilitySuggestion): Promise<BaseFacilitySuggestion> {
  const raw = await complete({
    model: config.llm.summaryModel,
    system: '旅行先の場所情報を整理します。必ずJSONオブジェクト1個だけを返してください。根拠のない設備は作らないでください。',
    user: [
      `場所名: ${place.name}`,
      `カテゴリ: ${place.category ?? '不明'}`,
      `説明: ${place.summary ?? 'なし'}`,
      `メモ: ${place.notes ?? 'なし'}`,
      '',
      'base_name: 拠点の場合だけ、日本語8文字以内・絵文字なし・識別しやすい短い名前。拠点でなければ空文字。',
      'facilities: この場所に含まれる施設・設備・体験を、利用者が「やりたい」と選べる短い名称の配列にする。',
      '出力例: {"base_name":"駅前ホテル","facilities":["大浴場","朝食ビュッフェ"]}',
    ].join('\n'),
  });
  const parsed = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
  return {
    baseName: place.is_base === 1 ? normalizeBaseName(parsed.base_name) : null,
    facilities: normalizeFacilities(parsed.facilities),
  };
}
