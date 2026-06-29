// 目標到着時刻からの逆算 (公共交通の暫定機能)。
// Google マップ取得の各経路候補の「運行間隔」を、最後に使う路線の時刻表の代わりに用いて、
// 目標時刻までに着く最も遅い便 (出発→到着) を計算する。運行間隔が不明な候補は調整不可。

import type { TransitOption } from '../types.js';

/** 'HH:MM' → 0時からの分。不正は null。 */
export function hhmmToMin(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 分 → 'HH:MM' (24時間で正規化)。 */
export function minToHhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * 候補を目標到着時刻 (分) に合わせてずらす。運行間隔で「目標までに着く最も遅い便」を求める。
 * @returns 調整後の候補。運行間隔/到着時刻が無く調整できないときは null。
 */
export function adjustOptionToTarget(opt: TransitOption, targetMin: number): TransitOption | null {
  const baseArrive = hhmmToMin(opt.arrive_time);
  const baseDepart = hhmmToMin(opt.depart_time);
  const interval = opt.interval_min;
  if (baseArrive == null || interval == null || interval <= 0) return null;

  // 到着が target を超えない最も近い便: baseArrive + n*interval (n は整数)。
  const n = Math.floor((targetMin - baseArrive) / interval);
  const adjArrive = baseArrive + n * interval;
  const dur =
    opt.duration_min != null ? opt.duration_min : baseDepart != null ? baseArrive - baseDepart : null;
  const adjDepart = dur != null ? adjArrive - dur : null;

  return {
    ...opt,
    arrive_time: minToHhmm(adjArrive),
    depart_time: adjDepart != null ? minToHhmm(adjDepart) : opt.depart_time,
  };
}
