// Google Maps JS API の動的ロード (Tirocinium CompanyMap.tsx のパターンを流用)。
// 型パッケージは入れず any で扱う (依存を増やさない)。
/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    google?: any;
    __peMapsLoading?: Promise<void>;
  }
}

// 先端が原点 (0,0)、円の中心が (0,-26)、半径 10 の水滴型ピン (Google 標準ピンと同形状)。
export const PIN_PATH = 'M 0,0 C -2,-17 -10,-19 -10,-26 A 10,10 0 0,1 10,-26 C 10,-19 2,-17 0,0 Z';

export function loadMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__peMapsLoading) return window.__peMapsLoading;
  window.__peMapsLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=ja&region=JP`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Maps の読み込みに失敗しました (APIキー/参照元制限を確認)'));
    document.head.appendChild(s);
  });
  return window.__peMapsLoading;
}
