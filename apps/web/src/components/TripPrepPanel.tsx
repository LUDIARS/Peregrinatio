import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { TripCheckItem, TripCheckListType, TripCheckStatus } from '../types.js';

const STATUS_LABEL: Record<TripCheckStatus, string> = {
  todo: '未着手',
  doing: '進行中',
  done: '完了',
};

const STATUS_ORDER: TripCheckStatus[] = ['todo', 'doing', 'done'];

function localDatetime(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T18:00`;
}

function ListEditor({
  tripId, listType, title, emptyText, items, onReload,
}: {
  tripId: string;
  listType: TripCheckListType;
  title: string;
  emptyText: string;
  items: TripCheckItem[];
  onReload: () => Promise<void>;
}) {
  const [itemTitle, setItemTitle] = useState('');
  const [details, setDetails] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = itemTitle.trim();
    if (!cleanTitle) return;
    setBusy(true); setError('');
    try {
      await api.createCheckItem(tripId, {
        list_type: listType,
        title: cleanTitle,
        details: details.trim() || null,
        category: category.trim() || null,
        quantity: listType === 'packing' ? quantity : null,
        due_at: listType === 'todo' ? dueAt || null : null,
        status: 'todo',
      });
      setItemTitle(''); setDetails(''); setCategory(''); setQuantity(1); setDueAt('');
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally { setBusy(false); }
  };

  const patch = async (id: string, input: Parameters<typeof api.patchCheckItem>[1]) => {
    setError('');
    try { await api.patchCheckItem(id, input); await onReload(); }
    catch (e) { setError(e instanceof Error ? e.message : '更新に失敗しました'); }
  };

  const remove = async (id: string) => {
    setError('');
    try { await api.deleteCheckItem(id); await onReload(); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <section className="prep-section">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="chip">{doneCount}/{items.length}</span>
      </div>
      {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}

      <form className="card foundation-form prep-form" onSubmit={add}>
        <input
          type="text"
          value={itemTitle}
          onChange={(e) => setItemTitle(e.target.value)}
          placeholder={listType === 'packing' ? '持ち物' : 'やること'}
        />
        {listType === 'packing' ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="カテゴリ"
              style={{ flex: 1, minWidth: 120 }}
            />
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              aria-label="数量"
              style={{ width: 78 }}
            />
          </div>
        ) : (
          <>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <div className="row prep-shortcuts">
              <button type="button" className="sm ghost" onClick={() => setDueAt(localDatetime(0))}>今日</button>
              <button type="button" className="sm ghost" onClick={() => setDueAt(localDatetime(1))}>明日</button>
              <button type="button" className="sm ghost" onClick={() => setDueAt(localDatetime(7))}>来週</button>
            </div>
          </>
        )}
        <textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="メモ" />
        <button type="submit" disabled={busy}>{busy ? '追加中...' : '追加'}</button>
      </form>

      {items.length === 0 && <p className="muted">{emptyText}</p>}
      <div className="stack prep-list">
        {items.map((item) => (
          <article key={item.id} className={`card prep-item ${item.status === 'done' ? 'is-done' : ''}`}>
            <div className="prep-item-main">
              <label className="prep-check">
                <input
                  type="checkbox"
                  checked={item.status === 'done'}
                  onChange={(e) => void patch(item.id, { status: e.target.checked ? 'done' : 'todo' })}
                />
                <span>{item.title}</span>
              </label>
              <button type="button" className="sm danger" onClick={() => void remove(item.id)}>削除</button>
            </div>
            <div className="prep-meta">
              {item.category && <span className="chip">{item.category}</span>}
              {item.quantity != null && listType === 'packing' && <span className="muted">x{item.quantity}</span>}
              {item.due_at && <span className="muted">期限 {item.due_at.replace('T', ' ')}</span>}
            </div>
            {item.details && <p className="muted prep-details">{item.details}</p>}
            {listType === 'todo' && (
              <div className="prep-status-row">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`sm ghost prep-status-${s}${item.status === s ? ' active' : ''}`}
                    onClick={() => void patch(item.id, { status: s })}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function TripPrepPanel({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<TripCheckItem[]>([]);
  const [error, setError] = useState('');

  const packing = useMemo(() => items.filter((i) => i.list_type === 'packing'), [items]);
  const todos = useMemo(() => items.filter((i) => i.list_type === 'todo'), [items]);

  const load = async () => {
    setError('');
    try { setItems(await api.listCheckItems(tripId)); }
    catch (e) { setError(e instanceof Error ? e.message : '準備リストの読み込みに失敗しました'); }
  };

  useEffect(() => { void load(); }, [tripId]);

  return (
    <div className="prep-panel">
      {error && <div className="card error">⚠ {error}</div>}
      <ListEditor
        tripId={tripId}
        listType="packing"
        title="持ち物"
        emptyText="まだ持ち物がありません。"
        items={packing}
        onReload={load}
      />
      <ListEditor
        tripId={tripId}
        listType="todo"
        title="TODO"
        emptyText="まだ TODO がありません。"
        items={todos}
        onReload={load}
      />
    </div>
  );
}
