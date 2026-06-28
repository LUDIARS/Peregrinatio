/* eslint-disable @typescript-eslint/no-explicit-any */
// 地図インスタンスをモジュールレベルで 1 つだけ保持し、画面遷移 (タブ切替) で再生成しない。
// 地図用 DOM を 1 度だけ生成してキャッシュし、各画面のホスト要素へ付け替える
// (アンマウント時は detach するだけで破棄しない)。これで Google 地図の再初期化・
// タイル再取得が起きず、タブ切替時のちらつきを防ぐ。
// マーカーもここで管理する (TripDetail のコンポーネント ref だと再マウントで参照を失い、
// 前の旅のピンが地図に残ってしまうため)。

let mapDiv: HTMLDivElement | null = null;
let mapObj: any = null;
let infoObj: any = null;
let centeredTripId: string | null = null;
let markers: any[] = [];

export interface AcquiredMap { map: any; info: any; div: HTMLDivElement; created: boolean }

/** 地図 (と InfoWindow) を取得。無ければ options で生成する。div はホストへ append して使う。 */
export function acquireMap(options: any): AcquiredMap {
  if (mapObj && mapDiv) return { map: mapObj, info: infoObj, div: mapDiv, created: false };
  const div = document.createElement('div');
  div.style.width = '100%';
  div.style.height = '100%';
  mapObj = new window.google.maps.Map(div, options);
  infoObj = new window.google.maps.InfoWindow();
  mapDiv = div;
  return { map: mapObj, info: infoObj, div, created: true };
}

/** 地図 DOM をホストから外す (破棄はしない。モジュールが参照を保持し続ける)。 */
export function releaseMap(): void {
  if (mapDiv && mapDiv.parentElement) mapDiv.parentElement.removeChild(mapDiv);
}

/** この旅でまだ自動センタリングしていないか (同じ旅に戻った時は再センタリングしない)。 */
export function needsCentering(tripId: string): boolean { return centeredTripId !== tripId; }
export function markCentered(tripId: string): void { centeredTripId = tripId; }

/** 既存マーカーを全消去する (再描画前)。 */
export function clearMarkers(): void {
  for (const m of markers) m.setMap(null);
  markers = [];
}
/** 描画したマーカーを記録する。 */
export function addMarker(m: any): void { markers.push(m); }
