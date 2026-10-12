// プラン案の表示用の整形 (純関数)。
// @implements SPEC-EXPRESS-PLAN

/** 秒 → 「N 分」/「H 時間 M 分」。不明は「—」。 */
export function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 時間 ${m % 60} 分`;
}
