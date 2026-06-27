import { Link, Outlet } from 'react-router-dom';
import { NavMenu } from './components/NavMenu.js';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        {/* タイトルロゴをタップで旅一覧 (ホーム) へ。ナビは NavMenu (PC=浮遊メニュー / モバイル=フッター)。 */}
        <Link to="/" className="brand-link" aria-label="旅一覧へ">
          <span className="brand">Peregrinatio</span>
          <span className="brand-sub">旅のしおり</span>
        </Link>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <NavMenu />
    </div>
  );
}
