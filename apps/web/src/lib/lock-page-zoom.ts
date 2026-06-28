// ページのピンチズーム / ダブルタップズームを抑止する (モバイル)。
//
// viewport meta の user-scalable=no は iOS Safari (iOS 10+) では無視されるため、
// JS で実際のジェスチャを止める。Google Maps のズームは残したいので、地図コンテナ
// (.gm-style / .map-canvas) 内で始まったジェスチャは対象外にする。地図は自前の
// touch 実装でズームするため、ここで preventDefault しても地図ズームには影響しない。

/** イベント対象が Google Maps の内側かどうか。 */
function isInsideMap(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.gm-style, .map-canvas') !== null;
}

/** ページのピンチ/ダブルタップズームを無効化する。1 度だけ呼ぶ。 */
export function lockPageZoom(): void {
  // 2 本指 (ピンチ) の touchmove をキャンセル。地図上は除外。単指スクロールは許可。
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && !isInsideMap(e.target)) e.preventDefault();
    },
    { passive: false },
  );

  // iOS Safari のページズーム (gesture* は非標準だが iOS で発火)。地図上は除外。
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(
      type,
      (e) => {
        if (!isInsideMap(e.target)) e.preventDefault();
      },
      { passive: false },
    );
  }

  // ダブルタップズーム抑止 (300ms 以内の連続タップの 2 度目の既定動作を止める)。地図上は除外。
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      if (now - lastTouchEnd <= 300 && !isInsideMap(e.target)) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
}
