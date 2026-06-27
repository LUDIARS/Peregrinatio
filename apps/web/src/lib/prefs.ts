// 表示設定 (localStorage 永続)。状態フィルタの既定 / 移動手段の既定など。

import type { RouteMode } from '../types.js';

export type StatusFilterPref = 'all' | 'interested' | 'visited';

export interface Prefs {
  defaultStatusFilter: StatusFilterPref;
  defaultRouteMode: RouteMode;
}

const KEY = 'pe.prefs';

const DEFAULTS: Prefs = {
  defaultStatusFilter: 'all',
  defaultRouteMode: 'driving',
};

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
