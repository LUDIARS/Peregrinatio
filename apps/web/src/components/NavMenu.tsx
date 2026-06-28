import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * グローバルナビ (5 セクション切替)。全画面で常時表示。
 * - モバイル (<900px): 下部フッタータブバー (フッター復活)。
 * - PC (≥900px): 「インタラクティブメニュー」= 画面上を自由移動できる浮遊メニュー。
 *     折りたたみ=☰ 1 個 / 展開=各役割ボタン。位置と開閉は localStorage に永続化。
 * 旅依存セクションは旅未選択 (tripId 無し) のとき無効化する。設定は常時有効。
 */

interface Section {
  key: string;
  label: string;
  icon: string;
  /** tripId からパスを作る (設定は tripId 不要)。 */
  to: (tripId: string | null) => string;
  tripScoped: boolean;
}

const SECTIONS: Section[] = [
  { key: 'map', label: 'マップとメモ', icon: '🗺', to: (id) => `/trips/${id}`, tripScoped: true },
  { key: 'itinerary', label: '旅のしおり', icon: '🗓', to: (id) => `/trips/${id}/itinerary`, tripScoped: true },
  { key: 'add', label: '情報追加', icon: '➕', to: (id) => `/trips/${id}/add`, tripScoped: true },
  { key: 'transit', label: '時刻表/運行', icon: '🚃', to: (id) => `/trips/${id}/transit`, tripScoped: true },
  { key: 'settings', label: '設定', icon: '⚙', to: () => '/settings', tripScoped: false },
];

const STORAGE_KEY = 'pe.navmenu';

function tripIdOf(pathname: string): string | null {
  const m = pathname.match(/^\/trips\/([^/]+)/);
  return m ? m[1]! : null;
}

/** pathname から現在のセクション key を判定。 */
function activeKey(pathname: string): string | null {
  if (pathname.startsWith('/settings')) return 'settings';
  const m = pathname.match(/^\/trips\/[^/]+(?:\/(\w+))?/);
  if (!m) return null;
  const sub = m[1];
  if (sub === 'itinerary') return 'itinerary';
  if (sub === 'add') return 'add';
  if (sub === 'transit') return 'transit';
  if (sub === 'days') return 'itinerary'; // 後方互換リダイレクト
  if (!sub) return 'map';
  return null;
}

interface Persisted {
  x: number;
  y: number;
  open: boolean;
}

function loadState(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        return { x: p.x, y: p.y, open: p.open ?? true };
      }
    }
  } catch {
    /* ignore */
  }
  // 既定は右下。
  const x = typeof window !== 'undefined' ? window.innerWidth - 96 : 800;
  const y = typeof window !== 'undefined' ? window.innerHeight - 96 : 600;
  return { x, y, open: false };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const LAST_TRIP_KEY = 'pe.lastTrip';

export function NavMenu() {
  const { pathname } = useLocation();
  const pathTripId = tripIdOf(pathname);
  const active = activeKey(pathname);

  // 旅を選択済みなら、旅に紐づかない画面 (設定など) でも旅依存ボタンを活性に保つため、
  // 直近に開いていた tripId を覚えてフォールバックに使う。
  const [lastTripId, setLastTripId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_TRIP_KEY); } catch { return null; }
  });
  useEffect(() => {
    if (!pathTripId) return;
    setLastTripId(pathTripId);
    try { localStorage.setItem(LAST_TRIP_KEY, pathTripId); } catch { /* ignore */ }
  }, [pathTripId]);
  const tripId = pathTripId ?? lastTripId;

  const [{ x, y, open }, setState] = useState<Persisted>(() => loadState());
  // ドラッグ管理: 移動量がしきい値未満なら「クリック (開閉)」とみなす。
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  // 状態を永続化。
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y, open }));
    } catch {
      /* ignore */
    }
  }, [x, y, open]);

  // 画面リサイズで画面外に出たら戻す。
  useEffect(() => {
    const onResize = () =>
      setState((s) => ({ ...s, x: clamp(s.x, 8, window.innerWidth - 56), y: clamp(s.y, 8, window.innerHeight - 56) }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true; // pointermove が来た = ドラッグ確定
    const nx = clamp(e.clientX - d.dx, 8, window.innerWidth - 56);
    const ny = clamp(e.clientY - d.dy, 8, window.innerHeight - 56);
    setState((s) => ({ ...s, x: nx, y: ny }));
  }, []);

  const onPointerUp = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    // moved が立っていなければクリック扱いはハンドラ側 onClick に任せる。
    setTimeout(() => { dragRef.current = null; }, 0);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      // 左ボタンのみ。
      if (e.button !== 0) return;
      dragRef.current = { dx: e.clientX - x, dy: e.clientY - y, moved: false };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [x, y, onPointerMove, onPointerUp],
  );

  const toggleOpen = useCallback(() => {
    // ドラッグ直後 (moved) のクリックは無視。
    if (dragRef.current?.moved) return;
    setState((s) => ({ ...s, open: !s.open }));
  }, []);

  const renderLink = (s: Section, cls: string) => {
    const disabled = s.tripScoped && !tripId;
    const isActive = active === s.key;
    if (disabled) {
      return (
        <span key={s.key} className={`${cls} disabled`} aria-disabled="true">
          <span className="navmenu-ico">{s.icon}</span>
          <span className="navmenu-label">{s.label}</span>
        </span>
      );
    }
    return (
      <Link key={s.key} to={s.to(tripId)} className={`${cls}${isActive ? ' active' : ''}`}>
        <span className="navmenu-ico">{s.icon}</span>
        <span className="navmenu-label">{s.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* モバイル: 下部フッタータブ */}
      <nav className="navmenu-mobile" aria-label="メニュー">
        {SECTIONS.map((s) => renderLink(s, 'navmenu-tab'))}
      </nav>

      {/* PC: 浮遊インタラクティブメニュー */}
      <div className="navmenu-pc" style={{ left: x, top: y }}>
        {open ? (
          <div className="navmenu-panel" role="menu">
            <button
              type="button"
              className="navmenu-drag"
              onPointerDown={startDrag}
              title="ドラッグで移動"
              aria-label="メニューを移動"
            >
              ⠿
            </button>
            {SECTIONS.map((s) => renderLink(s, 'navmenu-item'))}
            <button type="button" className="navmenu-collapse" onClick={() => setState((st) => ({ ...st, open: false }))} aria-label="閉じる">
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="navmenu-bubble"
            onPointerDown={startDrag}
            onClick={toggleOpen}
            title="メニュー (ドラッグで移動)"
            aria-label="メニューを開く"
          >
            メニュー
          </button>
        )}
      </div>
    </>
  );
}
