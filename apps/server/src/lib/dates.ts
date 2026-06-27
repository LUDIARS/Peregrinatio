/** 日付ユーティリティ。'YYYY-MM-DD' を境界に扱う (タイムゾーン非依存)。 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s);
}

/**
 * start..end (両端含む) の 'YYYY-MM-DD' を昇順で返す。
 * 不正な範囲 (start>end や日付でない) は空配列。max で日数の上限をガードする。
 */
export function enumerateDates(start: string, end: string, max = 60): string[] {
  if (!isDate(start) || !isDate(end)) return [];
  // UTC 正午基準で 1 日刻み (DST/TZ の影響を避ける)。
  const s = new Date(`${start}T12:00:00Z`).getTime();
  const e = new Date(`${end}T12:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [];
  const out: string[] = [];
  const DAY = 86_400_000;
  for (let t = s; t <= e && out.length < max; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
