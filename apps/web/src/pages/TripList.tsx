import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { Trip } from '../types.js';

export function TripList() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setStatus('loading');
    try {
      setTrips(await api.listTrips());
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      setStatus('error');
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.createTrip({
        title: title.trim(),
        start_date: start || undefined,
        end_date: end || undefined,
        notes: notes.trim() || undefined,
      });
      setTitle(''); setStart(''); setEnd(''); setNotes('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>旅一覧</h2>

      <form className="card foundation-form" onSubmit={create}>
        <h3>新しい旅をつくる</h3>
        <div>
          <label htmlFor="t-title">タイトル</label>
          <input id="t-title" type="text" placeholder="例: 京都ひとり旅"
            value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label htmlFor="t-start">開始日</label>
            <input id="t-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="t-end">終了日</label>
            <input id="t-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="t-notes">メモ</label>
          <textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="submit" disabled={saving || !title.trim()}>
          {saving ? '作成中…' : '旅を作成'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>

      {status === 'loading' && <p className="muted">読み込み中…</p>}
      {status === 'error' && <div className="card error">⚠ {error}</div>}
      {status === 'ready' && trips.length === 0 && (
        <p className="muted">まだ旅がありません。上のフォームから作成してください。</p>
      )}

      <div className="stack">
        {trips.map((t) => (
          <Link key={t.id} to={`/trips/${t.id}`} className="card card-link">
            <div className="spread">
              <strong>{t.title}</strong>
            </div>
            <div className="muted">
              {t.start_date ?? '日付未定'}{t.end_date ? ` 〜 ${t.end_date}` : ''}
            </div>
            {t.notes && <div className="muted" style={{ marginTop: 4 }}>{t.notes}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
