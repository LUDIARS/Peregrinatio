// 列車の運行日判定 (純関数)。祝日カレンダーは持たない (範囲外) ため、
// 'weekday' / 'holiday' は曜日だけで決め (土日 = holiday)、判定の弱さは呼び側が warnings に出す。
// @implements SPEC-EXPRESS-SUGGEST

import type { ExpressServiceNote } from './types.js';

export type ServiceDayVerdict = 'runs' | 'not_running' | 'unknown';

/** 'YYYY-MM-DD' の曜日 (0=日 … 6=土)。日付でなければ null。 */
export function weekdayOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

export function isWeekend(date: string): boolean {
  const w = weekdayOf(date);
  return w === 0 || w === 6;
}

/**
 * その日に走るか。自由文 ('臨時' 等) は判定できないので 'unknown'。
 * 呼び側は 'unknown' を候補から外さず、理由を warnings に出す。
 */
export function serviceDayVerdict(note: ExpressServiceNote, date: string): ServiceDayVerdict {
  const n = note.trim();
  if (n === '' || n === 'daily') return 'runs';
  if (weekdayOf(date) == null) return 'unknown';
  if (n === 'weekday') return isWeekend(date) ? 'not_running' : 'runs';
  if (n === 'holiday') return isWeekend(date) ? 'runs' : 'not_running';
  return 'unknown';
}

/** valid_from が旅の日付より 1 年以上前か (ダイヤ改正の可能性)。 */
export function isTimetableStale(validFrom: string | null, date: string): boolean {
  if (!validFrom || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = validFrom.split('-').map(Number) as [number, number, number];
  const oneYearLater = `${String(y + 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return date >= oneYearLater;
}
