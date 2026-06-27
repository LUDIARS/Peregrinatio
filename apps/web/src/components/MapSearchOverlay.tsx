import { useState } from 'react';
import { api } from '../api.js';
import type { PlaceSearchResult } from '../types.js';

interface Props {
  tripId: string;
  /** 検索の中心 (拠点座標があれば渡す。周辺を優先表示)。 */
  center?: { lat: number; lng: number } | null;
  /** 場所を旅に追加した後に一覧/地図を更新する。 */
  onChanged: () => void | Promise<void>;
}

/**
 * 場所を検索 — キーワードで施設を検索し、地図の上にオーバーレイ表示する。
 * 結果カードも地図に重ね、各「＋追加」でこの旅に追加する (旧インテリジェント検索の検索分)。
 * URL/画像からの情報追加は「情報追加」ページへ分離した。
 */
export function MapSearchOverlay({ tripId, center, onChanged }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.searchPlaces({ q: query, lat: center?.lat, lng: center?.lng });
      setResults(r);
      setOpen(true);
      setMsg(r.length === 0 ? '該当する施設が見つかりませんでした。' : '');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '検索に失敗しました');
      setOpen(true);
    } finally { setBusy(false); }
  };

  const add = async (c: PlaceSearchResult) => {
    try {
      await api.addPlaceToTrip(tripId, {
        name: c.name, address: c.address ?? undefined,
        lat: c.lat ?? undefined, lng: c.lng ?? undefined, category: c.category ?? undefined,
      });
      setResults((prev) => prev.filter((x) => x.place_id !== c.place_id));
      await onChanged();
    } catch (e) { setMsg(e instanceof Error ? e.message : '追加に失敗しました'); }
  };

  return (
    <div className="map-search">
      <div className="map-search-bar">
        <span className="map-search-ico">🔎</span>
        <input type="search" placeholder="場所を検索 (キーワード)" value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
        <button type="button" onClick={() => void run()} disabled={busy || !q.trim()}>
          {busy ? '検索中…' : '検索'}
        </button>
      </div>

      {open && (msg || results.length > 0) && (
        <div className="map-search-results">
          <div className="spread" style={{ marginBottom: 4 }}>
            <strong style={{ fontSize: 13 }}>検索結果 {results.length > 0 ? `(${results.length})` : ''}</strong>
            <button type="button" className="sm ghost" onClick={() => setOpen(false)}>閉じる</button>
          </div>
          {msg && <div className="muted">{msg}</div>}
          {results.map((c) => (
            <div key={c.place_id} className="map-search-row">
              <div style={{ minWidth: 0 }}>
                <strong>{c.name}</strong>
                {c.category && <span className="chip" style={{ marginLeft: 6 }}>{c.category}</span>}
                {c.address && <div className="muted" style={{ fontSize: 12 }}>{c.address}</div>}
              </div>
              <button type="button" className="sm" onClick={() => void add(c)}>＋追加</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
