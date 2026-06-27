// 表示設定 (localStorage 永続)。状態フィルタの既定 / 移動手段の既定など。

import type { RouteMode } from '../types.js';

export type StatusFilterPref = 'all' | 'interested' | 'visited';

export interface Prefs {
  defaultStatusFilter: StatusFilterPref;
  defaultRouteMode: RouteMode;
  userName: string; // 複数人編集の表示名 (最大8文字。初回はランダム付与、設定で変更可)。
}

const KEY = 'pe.prefs';

export const USER_NAME_MAX = 8;

const DEFAULTS: Omit<Prefs, 'userName'> = {
  defaultStatusFilter: 'all',
  defaultRouteMode: 'driving',
};

/** 8 文字のランダム表示名を作る (初回割り当て用)。 */
function randomUserName(): string {
  const s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return s.slice(0, USER_NAME_MAX);
}

export function getPrefs(): Prefs {
  let parsed: Partial<Prefs> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) parsed = JSON.parse(raw) as Partial<Prefs>;
  } catch {
    /* ignore */
  }
  const merged: Prefs = { ...DEFAULTS, userName: '', ...parsed };
  // userName 未設定なら初回ランダム付与して永続化する。
  if (!merged.userName) {
    merged.userName = randomUserName();
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  }
  return merged;
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  if (typeof next.userName === 'string') next.userName = next.userName.slice(0, USER_NAME_MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** 現在の表示名 (API ヘッダ等に使う)。 */
export function currentUserName(): string {
  return getPrefs().userName;
}
