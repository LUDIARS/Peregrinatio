// 時刻表の 1 セルを読む純関数。紙・PDF の時刻表の書き方をそのまま受ける:
//   6:20 / 06:20 / 620 / ６：２０  … 時刻
//   ↓ ↑ レ || ｜ ‖ 通過             … 通過 (停まらない)
//   空欄 / ― / … / =                 … 非経由 (その列車はこの駅を通らない)
//   着6:20 発6:22 / 6:20着 6:22発    … 着発併記
// @implements SPEC-EXPRESS-IMPORT

export type TimeCell =
  | { kind: 'none' }
  | { kind: 'pass' }
  | { kind: 'time'; arrive: string | null; depart: string | null }
  | { kind: 'invalid'; raw: string };

const PASS_MARKS = new Set(['↓', '↑', 'レ', 'ﾚ', '||', '|', '｜', '‖', '∥', '通過', '・']);
// NFKC 後の形で持つ ('…' → '...', '‥' → '..', '＝' → '=')。
const NONE_MARKS = new Set(['', '-', '―', '—', '–', '−', '...', '..', '=', '==']);

/** 'H:MM' / 'HMM' / 'HHMM' を 'HH:MM' に。時は 0〜29 (深夜の 24:xx 表記) まで受ける。 */
export function normalizeClock(value: string): string | null {
  const t = value.trim();
  const colon = /^(\d{1,2}):(\d{2})$/.exec(t);
  const compact = /^(\d{1,2})(\d{2})$/.exec(t);
  const m = colon ?? compact;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 29 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 'HH:MM' (24 時超可) → 0 時からの分。 */
export function clockToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 0 時からの分 → 'HH:MM' (24 時超はそのまま伸ばす)。 */
export function minutesToClock(minutes: number): string {
  const v = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 「着6:20」(記号が前) と「6:20着」(記号が後) のどちらの書き方かはセルの先頭で決める。 */
function marked(text: string, mark: '着' | '発'): string | null {
  const re = /^[着発]/.test(text)
    ? new RegExp(`${mark}\\s*(\\d{1,2}:?\\d{2})`)
    : new RegExp(`(\\d{1,2}:?\\d{2})\\s*${mark}`);
  const hit = re.exec(text)?.[1];
  return hit ? normalizeClock(hit) : null;
}

/** 1 セルを読む。全角数字・全角コロンは NFKC で半角に寄せてから判定する。 */
export function parseTimeCell(raw: string): TimeCell {
  const text = raw.normalize('NFKC').trim();
  if (NONE_MARKS.has(text)) return { kind: 'none' };
  if (PASS_MARKS.has(text)) return { kind: 'pass' };

  if (/[着発]/.test(text)) {
    const arrive = marked(text, '着');
    const depart = marked(text, '発');
    if (arrive || depart) return { kind: 'time', arrive, depart };
    return { kind: 'invalid', raw };
  }

  const clock = normalizeClock(text);
  if (clock) return { kind: 'time', arrive: null, depart: clock };
  return { kind: 'invalid', raw };
}

/** 駅名の列の「着」「発」表記を外す (例: '大宮 着' / '大宮(発)' → { name: '大宮', role: 'arrive' })。 */
export function splitStationRole(raw: string): { name: string; role: 'arrive' | 'depart' | null } {
  const text = raw.normalize('NFKC').trim();
  const m = /^(.*?)[\s(（]*(着|発)[)）]?$/.exec(text);
  if (m && m[1] && m[1].trim()) {
    return { name: m[1].trim(), role: m[2] === '着' ? 'arrive' : 'depart' };
  }
  return { name: text, role: null };
}
