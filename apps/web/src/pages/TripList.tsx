import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { Trip } from '../types.js';

const today = () => new Date().toISOString().slice(0, 10);

/** 終了日(無ければ開始日)が今日より前なら「過去の旅」。 */
function isPast(t: Trip): boolean {
  const ref = t.end_date ?? t.start_date;
  return ref != null && ref < today();
}

export function TripList() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setStatus('loading');
    try { setTrips(await api.listTrips()); setStatus('ready'); }
    catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); setStatus('error'); }
  };
  useEffect(() => { void load(); }, []);

  const { planned, past } = useMemo(() => {
    const planned: Trip[] = [];
    const past: Trip[] = [];
    for (const t of trips) (isPast(t) ? past : planned).push(t);
    // 計画は開始日が近い順、過去は新しい順
    planned.sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
    past.sort((a, b) => (b.end_date ?? b.start_date ?? '').localeCompare(a.end_date ?? a.start_date ?? ''));
    return { planned, past };
  }, [trips]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await api.createTrip({
        title: title.trim(),
        start_date: start || undefined,
        end_date: end || undefined,
        notes: notes.trim() || undefined,
      });
      setTitle(''); setStart(''); setEnd(''); setNotes(''); setShowForm(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '作成に失敗しました'); }
    finally { setSaving(false); }
  };

  const TripCard = (t: Trip) => (
    <Link key={t.id} to={`/trips/${t.id}`} className="card card-link">
      <div className="spread"><strong>{t.title}</strong></div>
      <div className="muted">{t.start_date ?? '日付未定'}{t.end_date ? ` 〜 ${t.end_date}` : ''}</div>
      {t.notes && <div className="muted" style={{ marginTop: 4 }}>{t.notes}</div>}
    </Link>
  );

  return (
    <div>
      <div className="spread">
        <h2 style={{ margin: 0 }}>旅一覧</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? '✕ 閉じる' : '＋ 新規作成'}
        </button>
      </div>

      {showForm && (
        <form className="card foundation-form" onSubmit={create} style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>新しい旅をつくる</h3>
          <div>
            <label htmlFor="t-title">タイトル</label>
            <input id="t-title" type="text" placeholder="例: 京都ひとり旅" autoFocus
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
          <button type="submit" disabled={saving || !title.trim()}>{saving ? '作成中…' : '旅を作成'}</button>
          {error && <div className="error">{error}</div>}
        </form>
      )}

      {status === 'loading' && <p className="muted">読み込み中…</p>}
      {status === 'error' && <div className="card error">⚠ {error}</div>}

      {status === 'ready' && (
        <>
          <h3>旅の計画 ({planned.length})</h3>
          {planned.length === 0
            ? <p className="muted">計画中の旅はありません。「＋ 新規作成」から追加してください。</p>
            : <div className="stack">{planned.map(TripCard)}</div>}

          <h3 style={{ marginTop: 20 }}>過去の旅 ({past.length})</h3>
          {past.length === 0
            ? <p className="muted">過去の旅はまだありません。</p>
            : <div className="stack">{past.map(TripCard)}</div>}
        </>
      )}
    </div>
  );
}
