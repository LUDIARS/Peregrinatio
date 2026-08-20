// 旅の日付 → 季節・気候ウィンドウの判定 (純関数・IO なし)。
// 「秋 = 紅葉」「夏 = 日避け」のように、月ではなく期間 (MMDD) で判定する。
// 紅葉が 10 月中旬から、猛暑が 7 月中旬から、のように季節の境と実際の
// 支度の境がずれるため、季節ラベルと気候ウィンドウを別々に持つ。

import type { SeasonalHint } from './types.js';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

const DAY_MS = 86_400_000;

interface ParsedDate {
  year: number;
  month: number;
  day: number;
  ordinal: number;
}

function parseDate(date: string): ParsedDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestamp);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day) return null;
  return { year, month, day, ordinal: Math.floor(timestamp / DAY_MS) };
}

function rangeDateOrdinal(year: number, mmdd: number): number {
  const month = Math.floor(mmdd / 100);
  const day = mmdd % 100;
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** 気候ウィンドウの識別子。荷物ルール (packing-season-rules) の照合キー。 */
export type ClimateWindow =
  | 'cherry_blossom'  // 桜
  | 'pollen'          // 花粉
  | 'rainy'           // 梅雨
  | 'heat'            // 猛暑 (日避け)
  | 'typhoon'         // 台風
  | 'autumn_leaves'   // 紅葉
  | 'cold'            // 厳寒
  | 'snow';           // 降雪

/** 'YYYY-MM-DD' → MMDD の数値。パースできなければ null。 */
export function monthDayNumber(date: string): number | null {
  const parsed = parseDate(date);
  return parsed ? parsed.month * 100 + parsed.day : null;
}

/** MMDD が [from, to] に入るか。年をまたぐ範囲 (1215-0228 等) にも対応する。 */
export function inMonthDayRange(mmdd: number, from: number, to: number): boolean {
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

const SEASON_RANGES: Array<{ season: Season; from: number; to: number }> = [
  { season: 'spring', from: 301, to: 531 },
  { season: 'summer', from: 601, to: 831 },
  { season: 'autumn', from: 901, to: 1130 },
  { season: 'winter', from: 1201, to: 229 },
];

/** 日付の季節。パース不能なら null。 */
export function seasonOf(date: string): Season | null {
  const mmdd = monthDayNumber(date);
  if (mmdd == null) return null;
  return SEASON_RANGES.find((r) => inMonthDayRange(mmdd, r.from, r.to))?.season ?? null;
}

interface ClimateRange {
  window: ClimateWindow;
  from: number;
  to: number;
  label: string;
  detail: string;
}

const CLIMATE_RANGES: ClimateRange[] = [
  {
    window: 'pollen', from: 215, to: 430,
    label: '花粉', detail: 'スギ・ヒノキの飛散期。屋外の観光が続く日は目薬とマスクがあると持ちこたえられる。',
  },
  {
    window: 'cherry_blossom', from: 320, to: 430,
    label: '桜', detail: '桜の見頃。朝夕は冷えるので花見の待ち時間に羽織るものが要る。',
  },
  {
    window: 'rainy', from: 601, to: 715,
    label: '梅雨', detail: '雨天前提で組む。屋内の代替候補を各日に 1 つ持っておくと崩れにくい。',
  },
  {
    window: 'heat', from: 710, to: 910,
    label: '猛暑', detail: '日中の屋外は消耗が早い。11〜15 時を屋内・日陰に寄せ、日避けを装備する。',
  },
  {
    window: 'typhoon', from: 810, to: 1010,
    label: '台風', detail: '交通が止まりうる時期。公共交通で組むなら振替の余地を残す。',
  },
  {
    window: 'autumn_leaves', from: 1010, to: 1210,
    label: '紅葉', detail: '紅葉の見頃。名所は午前が空いていて光も回る。日没が早い分、閉門時刻に注意。',
  },
  {
    window: 'cold', from: 1201, to: 228,
    label: '厳寒', detail: '朝晩の冷え込みが強い。屋外の待ち時間を短くする組み方にする。',
  },
  {
    window: 'snow', from: 1215, to: 315,
    label: '降雪', detail: '積雪・路面凍結の可能性。車移動なら所要が伸びる前提で見積もる。',
  },
];

/** その日付に当てはまる気候ウィンドウ。 */
export function climateWindowsOf(date: string): ClimateWindow[] {
  const mmdd = monthDayNumber(date);
  if (mmdd == null) return [];
  return CLIMATE_RANGES.filter((r) => inMonthDayRange(mmdd, r.from, r.to)).map((r) => r.window);
}

/**
 * 旅の期間 (開始〜終了) と重なる気候ウィンドウを集める。
 * 両端が範囲外でも、旅行中に梅雨などの期間をまたぐ場合は取りこぼさない。
 */
export function climateWindowsOfTrip(startDate: string | null, endDate: string | null): ClimateWindow[] {
  if (!startDate && !endDate) return [];
  if (!startDate || !endDate) return climateWindowsOf(startDate ?? endDate ?? '');

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end.ordinal < start.ordinal) return [];

  const windows: ClimateWindow[] = [];
  for (const range of CLIMATE_RANGES) {
    let overlaps = false;
    // 年跨ぎ範囲を拾うため、開始前年を含めて各年の実日付区間へ展開する。
    for (let year = start.year - 1; year <= end.year && !overlaps; year += 1) {
      const rangeStart = rangeDateOrdinal(year, range.from);
      const rangeEnd = rangeDateOrdinal(range.from <= range.to ? year : year + 1, range.to);
      overlaps = rangeStart <= end.ordinal && rangeEnd >= start.ordinal;
    }
    if (overlaps) windows.push(range.window);
  }
  return windows;
}

/** 気候ウィンドウを読み物のヒントに変換する。 */
export function seasonalHints(windows: ClimateWindow[]): SeasonalHint[] {
  const seen = new Set<ClimateWindow>();
  const hints: SeasonalHint[] = [];
  for (const w of windows) {
    if (seen.has(w)) continue;
    seen.add(w);
    const range = CLIMATE_RANGES.find((r) => r.window === w);
    if (range) hints.push({ key: range.window, label: range.label, detail: range.detail });
  }
  return hints;
}

/** 旅の季節ラベル ('秋' 等)。開始日を優先し、無ければ終了日で判定する。 */
export function seasonLabelOfTrip(startDate: string | null, endDate: string | null): string | null {
  const season = (startDate && seasonOf(startDate)) || (endDate && seasonOf(endDate)) || null;
  return season ? SEASON_LABEL[season] : null;
}
