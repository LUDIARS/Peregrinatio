import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { NavMenu } from './components/NavMenu.js';
import { api } from './api.js';
import { recordTripAccess } from './lib/recentTripAccess.js';

function TripAccessRecorder() {
  const { pathname } = useLocation();
  useEffect(() => {
    const tripId = pathname.match(/^\/trips\/([^/]+)/)?.[1];
    if (!tripId) return;
    api.getTrip(tripId).then(({ trip }) => recordTripAccess(trip)).catch(() => { /* ページ側でエラーを表示 */ });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand-link" aria-label="アクセス履歴へ">
          <span className="brand">Peregrinatio</span>
          <span className="brand-sub">旅のしおり</span>
        </Link>
      </header>

      <main className="app-main">
        <TripAccessRecorder />
        <Outlet />
      </main>

      <NavMenu />
    </div>
  );
}
