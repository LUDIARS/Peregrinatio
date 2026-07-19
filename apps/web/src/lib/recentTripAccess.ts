import type { SharedTripSummary, Trip } from '../types.js';

const RECENT_KEY = 'pe.recent-trip-pages.v1';
const SHARE_ALIAS_KEY = 'pe.trip-share-aliases.v1';
const MAX_RECENT = 30;

export interface RecentTripAccess {
  tripId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  path: string;
  accessedAt: string;
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

export function listRecentTripAccesses(): RecentTripAccess[] {
  return readJson<RecentTripAccess[]>(RECENT_KEY, [])
    .filter((item) => item && typeof item.tripId === 'string' && typeof item.path === 'string')
    .sort((a, b) => b.accessedAt.localeCompare(a.accessedAt));
}

export function recordTripAccess(trip: Trip | SharedTripSummary, path?: string): void {
  const tripId = 'trip_id' in trip ? trip.trip_id : trip.id;
  const aliases = readJson<Record<string, string>>(SHARE_ALIAS_KEY, {});
  const item: RecentTripAccess = {
    tripId,
    title: trip.title,
    startDate: trip.start_date,
    endDate: trip.end_date,
    path: path ?? aliases[tripId] ?? `/trips/${tripId}`,
    accessedAt: new Date().toISOString(),
  };
  const next = [item, ...listRecentTripAccesses().filter((old) => old.tripId !== tripId)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* WebStorage利用不可 */ }
}

export function rememberShareAlias(tripId: string, token: string): void {
  const aliases = readJson<Record<string, string>>(SHARE_ALIAS_KEY, {});
  aliases[tripId] = `/s/${encodeURIComponent(token)}`;
  try { localStorage.setItem(SHARE_ALIAS_KEY, JSON.stringify(aliases)); } catch { /* WebStorage利用不可 */ }
}

export function removeRecentTripAccess(tripId: string): void {
  const next = listRecentTripAccesses().filter((item) => item.tripId !== tripId);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* WebStorage利用不可 */ }
}
