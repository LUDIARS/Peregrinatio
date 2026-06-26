import { useEffect, useState } from 'react';
import { api, assetUrl } from '../api.js';
import type { Place } from '../types.js';

const STATUS_LABEL: Record<string, string> = { interested: '気になる', visited: '訪問済み' };

interface Props {
  tripId: string;
  /** すでにこの旅に紐づく場所 id (候補から除外する)。 */
  existingIds: Set<string>;
  /** 追加完了後に親へ通知 (TripDetail.reload)。 */
  onAdded: () => void | Promise<void>;
}

/**
 * 場所ライブラリ (全旅共有) から既存の場所を選んで、この旅に紐付ける。
 * 検索カードが「Places から新規作成」なのに対し、こちらは「他の旅で登録済みの場所を使い回す」。
 * API: GET /api/places (一覧) → POST /api/trips/:id/places { place_id } (紐付け)。
 */
export function LibraryPicker({ tripId, existingIds, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const all = await api.listLibrary({ q: q.trim() || undefined });
      const candidates = all.filter((p) => !existingIds.has(p.id));
      setItems(candidates);
      if (candidates.length === 0) {
        setMsg(all.length === 0 ? 'ライブラリにまだ場所がありません。' : 'この旅に未追加の場所はありません。');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'ライブラリの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 開いたとき / この旅の場所集合が変わったときに再ロード (除外候補の同期)。
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingIds]);

  const add = async (p: Place) => {
    setAddingId(p.id);
    setMsg('');
    try {
      await api.addPlaceToTrip(tripId, { place_id: p.id });
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      await onAdded();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="card foundation-form" style={{ marginTop: 10 }}>
      <button
        type="button"
        className="ghost"
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left' }}
      >
        📚 ライブラリから既存の場所を追加 {open ? '▲' : '▼'}
      </button>
      {open && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="search"
              placeholder="場所名で絞り込み"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
              style={{ flex: 1 }}
            />
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '…' : '絞り込み'}
            </button>
          </div>
          {msg && <div className="muted">{msg}</div>}
          <div className="stack">
            {items.map((p) => (
              <div key={p.id} className="spread" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap', flex: 1, minWidth: 0 }}>
                  {p.image_url && (
                    <img
                      className="thumb"
                      src={assetUrl(p.image_url)}
                      alt={p.name}
                      style={{ width: 48, aspectRatio: '1 / 1', flex: '0 0 auto' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{p.name}</strong>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      {p.status !== 'none' && STATUS_LABEL[p.status] && (
                        <span className={`chip status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                      )}
                      {p.category && <span className="chip">{p.category}</span>}
                      {p.lat == null && <span className="muted">位置なし</span>}
                    </div>
                    {p.address && <div className="muted">{p.address}</div>}
                  </div>
                </div>
                <button type="button" className="sm ghost" onClick={() => void add(p)} disabled={addingId === p.id}>
                  {addingId === p.id ? '追加中…' : '追加'}
                </button>
              </div>
            ))}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            他の旅で登録済みの場所を、この旅にも紐付けます（場所は全旅で共有）。
          </p>
        </>
      )}
    </div>
  );
}
