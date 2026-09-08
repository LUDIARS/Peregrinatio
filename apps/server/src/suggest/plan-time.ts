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

/**
 * GTFS の時刻 ('HH:MM' / 'HH:MM:SS'、24 時超あり) を 0 時からの分に直す。
 * 深夜便は 25:10 のように 24 時を超えて表記されるため、上限で丸めない。
 */
export function gtfsTimeToMinutes(time: string | null | undefined): number | null {
  if (typeof time !== 'string') return null;
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const minutes = Number(m[2]);
  if (minutes > 59) return null;
  return Number(m[1]) * 60 + minutes;
}

/** 0 時からの分を GTFS 検索へ渡す 'HH:MM' にする (24 時超はそのまま伸ばす)。 */
export function minutesToSearchTime(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → GTFS 検索の 'YYYYMMDD'。日付でなければ null。 */
export function toGtfsDate(date: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}
