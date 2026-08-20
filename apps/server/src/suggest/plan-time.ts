/** 'HH:MM' と分数の相互変換 (純関数)。プランの時刻計算はすべて「その日の 0 時からの分」で行う。 */

const HHMM_RE = /^([0-9]{1,2}):([0-9]{2})$/;

/** 'HH:MM' → 0 時からの分。不正なら null。 */
export function parseHhmm(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = HHMM_RE.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 0 時からの分 → 'HH:MM'。24 時を超えた分は翌日側へ回さず 23:59 で止める。 */
export function formatHhmm(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
