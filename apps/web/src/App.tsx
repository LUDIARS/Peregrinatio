import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { pdfUrl } from './api.js';

/** 現在の URL から trip id を取り出す (/trips/:id/...)。 */
function currentTripId(pathname: string): string | null {
  const m = pathname.match(/^\/trips\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function App() {
  const location = useLocation();
  const tripId = currentTripId(location.pathname);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Peregrinatio</span>
        <span className="brand-sub">旅のしおり</span>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="メインナビ">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="tab-ico">🧳</span>
          <span className="tab-label">旅一覧</span>
        </NavLink>

        {tripId ? (
          <NavLink
            to={`/trips/${tripId}`}
            end
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            <span className="tab-ico">🗺️</span>
            <span className="tab-label">地図</span>
          </NavLink>
        ) : (
          <span className="tab disabled">
            <span className="tab-ico">🗺️</span>
            <span className="tab-label">地図</span>
          </span>
        )}

        {tripId ? (
          <a className="tab" href={pdfUrl(tripId)} target="_blank" rel="noreferrer">
            <span className="tab-ico">📄</span>
            <span className="tab-label">しおり</span>
          </a>
        ) : (
          <span className="tab disabled">
            <span className="tab-ico">📄</span>
            <span className="tab-label">しおり</span>
          </span>
        )}
      </nav>
    </div>
  );
}
