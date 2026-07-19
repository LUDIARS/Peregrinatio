import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { recordTripAccess, rememberShareAlias } from '../lib/recentTripAccess.js';
import type { SharedTripSummary } from '../types.js';

export function SharedTripGate() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const openTrip = (trip: SharedTripSummary) => {
    if (!token) return;
    rememberShareAlias(trip.trip_id, token);
    recordTripAccess(trip, `/s/${encodeURIComponent(token)}`);
    navigate(`/trips/${trip.trip_id}`, { replace: true });
  };

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const result = await api.inspectSharedTrip(token);
        if (result.trip) openTrip(result.trip);
        else setNeedsPassword(result.password_protected === true);
      } catch (e) { setError(e instanceof Error ? e.message : '共有リンクを開けませんでした'); }
      finally { setBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true); setError('');
    try { openTrip((await api.unlockSharedTrip(token, password)).trip); }
    catch (e) { setError(e instanceof Error ? e.message : '合言葉を確認できませんでした'); }
    finally { setBusy(false); }
  };

  if (busy && !needsPassword) return <p className="muted">共有リンクを確認中…</p>;
  return (
    <div className="share-gate card">
      <h2>共有された旅を開く</h2>
      {needsPassword && (
        <form className="foundation-form" onSubmit={unlock}>
          <label>合言葉
            <input type="password" value={password} autoFocus onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" disabled={busy || !password}>{busy ? '確認中…' : '旅を開く'}</button>
        </form>
      )}
      {error && <div className="error">⚠ {error}</div>}
    </div>
  );
}
