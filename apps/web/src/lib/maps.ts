/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    google?: any;
    __peMapsLoading?: Promise<void>;
    __peMapsCallback?: () => void;
  }
}

export const PIN_PATH = 'M 0,0 C -2,-17 -10,-19 -10,-26 A 10,10 0 0,1 10,-26 C 10,-19 2,-17 0,0 Z';

export interface TransitRouteStyleInput {
  routeType?: number | null;
  routeLabel?: string | null;
  routeName?: string | null;
  headsign?: string | null;
  feedName?: string | null;
}

export interface TransitRouteStyle {
  kind: 'bus' | 'shinkansen' | 'rail';
  strokeColor: string;
  markerColor: string;
  labelColor: string;
}

export function transitRouteStyle(input: TransitRouteStyleInput): TransitRouteStyle {
  const text = [
    input.routeLabel,
    input.routeName,
    input.headsign,
    input.feedName,
  ].filter(Boolean).join(' ');
  const isShinkansen = /\bshinkansen\b/i.test(text) || text.includes('\u65b0\u5e79\u7dda');
  if (isShinkansen) {
    return { kind: 'shinkansen', strokeColor: '#facc15', markerColor: '#eab308', labelColor: '#1f2937' };
  }
  if (input.routeType === 3) {
    return { kind: 'bus', strokeColor: '#16a34a', markerColor: '#15803d', labelColor: '#fff' };
  }
  return { kind: 'rail', strokeColor: '#0e7c86', markerColor: '#0e7c86', labelColor: '#fff' };
}

let legacyMapsCacheCleared = false;
const MAPS_SCRIPT_ID = 'pe-google-maps-js';
const MAPS_CALLBACK = '__peMapsCallback';
const MAPS_CACHE_BUST = '20260708';

function mapsScriptUrl(apiKey: string): string {
  const url = new URL('https://maps.googleapis.com/maps/api/js');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', 'ja');
  url.searchParams.set('region', 'JP');
  url.searchParams.set('v', 'weekly');
  url.searchParams.set('loading', 'async');
  url.searchParams.set('libraries', 'places');
  url.searchParams.set('callback', MAPS_CALLBACK);
  url.searchParams.set('pe_sw_bust', MAPS_CACHE_BUST);
  return url.toString();
}

function resetMapsLoader(): void {
  delete window.__peMapsLoading;
  delete window.__peMapsCallback;
  document.getElementById(MAPS_SCRIPT_ID)?.remove();
}

async function clearLegacyMapsCache(): Promise<void> {
  if (legacyMapsCacheCleared) return;
  legacyMapsCacheCleared = true;
  try {
    if ('caches' in window) await window.caches.delete('google-maps');
  } catch {
    // Best effort only. A cache cleanup failure must not block map loading.
  }
}

export function loadMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__peMapsLoading) return window.__peMapsLoading;

  window.__peMapsLoading = (async () => {
    await clearLegacyMapsCache();
    await new Promise<void>((resolve, reject) => {
      document.getElementById(MAPS_SCRIPT_ID)?.remove();

      const s = document.createElement('script');
      let settled = false;
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        resetMapsLoader();
        reject(error);
      };

      window.__peMapsCallback = () => {
        if (settled) return;
        if (!window.google?.maps) {
          rejectOnce(new Error('Google Maps is not available after the API script loaded'));
          return;
        }
        settled = true;
        delete window.__peMapsCallback;
        resolve();
      };

      s.id = MAPS_SCRIPT_ID;
      s.src = mapsScriptUrl(apiKey);
      s.async = true;
      s.onerror = () => rejectOnce(new Error('Google Maps の読み込みに失敗しました (APIキー/参照元制限を確認)'));
      document.head.appendChild(s);
    });
  })().catch(error => {
    delete window.__peMapsLoading;
    throw error;
  });

  return window.__peMapsLoading;
}
