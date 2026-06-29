// 「直近に開いていた旅」を localStorage で覚える共有ヘルパー。
// 旅に紐づかない画面 (設定など) でも、直近の旅を対象に操作できるようにする
// (NavMenu の旅依存ボタン活性 / 設定ページの旅編集)。

const LAST_TRIP_KEY = 'pe.lastTrip';

export function getLastTripId(): string | null {
  try { return localStorage.getItem(LAST_TRIP_KEY); } catch { return null; }
}

export function setLastTripId(id: string): void {
  try { localStorage.setItem(LAST_TRIP_KEY, id); } catch { /* ignore */ }
}
