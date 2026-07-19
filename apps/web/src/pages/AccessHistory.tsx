import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listRecentTripAccesses, removeRecentTripAccess, type RecentTripAccess } from '../lib/recentTripAccess.js';

export function AccessHistory() {
  const [items, setItems] = useState<RecentTripAccess[]>(() => listRecentTripAccesses());
  const remove = (tripId: string) => {
    removeRecentTripAccess(tripId);
    setItems(listRecentTripAccesses());
  };

  return (
    <div className="access-home">
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>この端末で開いた旅</h2>
          <p className="muted">履歴はこのブラウザのWebStorageだけに保存されます。</p>
        </div>
        <Link to="/trips" className="sm button-link">旅を管理</Link>
      </div>
      {items.length === 0 ? (
        <div className="card">
          <p>まだ開いた旅はありません。</p>
          <p className="muted">共有されたリンクを開くと、ここからもう一度アクセスできます。</p>
        </div>
      ) : (
        <div className="trip-cards">
          {items.map((item) => (
            <div key={item.tripId} className="trip-card">
              <Link to={item.path} className="trip-card-main">
                <strong className="trip-card-title">{item.title}</strong>
                <div className="muted">{item.startDate ?? '日付未定'}{item.endDate ? ` 〜 ${item.endDate}` : ''}</div>
                <div className="muted">最終アクセス: {new Date(item.accessedAt).toLocaleString('ja-JP')}</div>
              </Link>
              <button type="button" className="trip-card-menu-btn" aria-label="履歴から削除" onClick={() => remove(item.tripId)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
