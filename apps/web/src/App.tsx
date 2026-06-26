import { Link, Outlet } from 'react-router-dom';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        {/* タイトルロゴをタップで旅一覧 (ホーム) へ。フッターは廃止。 */}
        <Link to="/" className="brand-link" aria-label="旅一覧へ">
          <span className="brand">Peregrinatio</span>
          <span className="brand-sub">旅のしおり</span>
        </Link>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
