import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { ItineraryItem, Place, RouteLeg, RouteMode, TripDay } from '../types.js';

const MODES: { value: RouteMode; label: string }[] = [
  { value: 'walking', label: '徒歩' },
  { value: 'driving', label: '車' },
  { value: 'transit', label: '公共交通' },
  { value: 'bicycling', label: '自転車' },
];

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分`;
  return `${Math.floor(m / 60)} 時間 ${m % 60} 分`;
}
function fmtDistance(m: number | null): string {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function DayPlanner() {
  const { tripId, dayId } = useParams<{ tripId: string; dayId: string }>();
  const [day, setDay] = useState<TripDay | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [selPlace, setSelPlace] = useState('');
  const [mode, setMode] = useState<RouteMode>('walking');

  const placeName = (id: string | null) => (id ? places.find((p) => p.id === id)?.name ?? '(不明)' : '(メモ)');

  const loadAll = async () => {
    if (!tripId || !dayId) return;
    const detail = await api.getTrip(tripId);
    setDay(detail.days.find((d) => d.id === dayId) ?? null);
    setPlaces(detail.places);
    const [it, lg] = await Promise.all([api.listItems(dayId), api.getRoute(dayId)]);
    setItems([...it].sort((a, b) => a.order_index - b.order_index));
    setLegs(lg);
  };

  useEffect(() => {
    (async () => {
      try { await loadAll(); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, dayId]);

  const addItem = async () => {
    if (!dayId || !selPlace) return;
    setBusy('add');
    setError('');
    try {
      await api.createItem(dayId, { place_id: selPlace, kind: 'visit' });
      setSelPlace('');
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally { setBusy(''); }
  };

  const removeItem = async (id: string) => {
    try { await api.deleteItem(id); await loadAll(); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  // 隣接する 2 件の order_index を入れ替える。
  const move = async (idx: number, dir: -1 | 1) => {
    const a = items[idx];
    const b = items[idx + dir];
    if (!a || !b) return;
    setBusy('move');
    try {
      await api.patchItem(a.id, { order_index: b.order_index });
      await api.patchItem(b.id, { order_index: a.order_index });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : '並べ替えに失敗しました');
    } finally { setBusy(''); }
  };

  const computeRoute = async () => {
    if (!dayId) return;
    setBusy('route');
    setError('');
    try {
      setLegs(await api.computeRoute(dayId, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : '経路探索に失敗しました');
    } finally { setBusy(''); }
  };

  if (!tripId || !dayId) return null;
  if (error && !day) return <div className="card error">⚠ {error}</div>;

  return (
    <div>
      <div className="crumb"><Link to={`/trips/${tripId}`}>← 旅へ戻る</Link></div>
      <h2>{day ? (day.title || `${day.day_index + 1} 日目`) : '日程'}</h2>
      {day?.date && <p className="muted">{day.date}</p>}

      {/* 予定一覧 */}
      <h3>行動予定 ({items.length})</h3>
      {items.length === 0 && <p className="muted">まだ予定がありません。下から場所を追加してください。</p>}
      <div className="stack">
        {items.map((it, idx) => (
          <div key={it.id} className="card item-row">
            <div className="ord-btns">
              <button type="button" disabled={idx === 0 || busy === 'move'} onClick={() => void move(idx, -1)}>▲</button>
              <button type="button" disabled={idx === items.length - 1 || busy === 'move'} onClick={() => void move(idx, 1)}>▼</button>
            </div>
            <div className="grow">
              <strong>{placeName(it.place_id)}</strong>
              {it.planned_time && <span className="chip" style={{ marginLeft: 6 }}>{it.planned_time}</span>}
              {it.note && <div className="muted">{it.note}</div>}
            </div>
            <button type="button" className="sm danger" onClick={() => void removeItem(it.id)}>削除</button>
          </div>
        ))}
      </div>

      {/* 場所を追加 */}
      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>場所を予定に追加</h3>
        <select value={selPlace} onChange={(e) => setSelPlace(e.target.value)}>
          <option value="">— 旅の場所から選ぶ —</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" onClick={() => void addItem()} disabled={!selPlace || busy === 'add'}>
          {busy === 'add' ? '追加中…' : '予定に追加'}
        </button>
      </div>

      {/* 経路探索 */}
      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>経路探索</h3>
        <div className="row">
          <select value={mode} onChange={(e) => setMode(e.target.value as RouteMode)} style={{ flex: 1 }}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button type="button" onClick={() => void computeRoute()} disabled={busy === 'route' || items.length < 2}>
            {busy === 'route' ? '探索中…' : '経路探索'}
          </button>
        </div>
        {items.length < 2 && <p className="muted">2 件以上の予定があると経路を計算できます。</p>}

        {legs.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {legs.map((leg) => (
              <div key={leg.id} className="leg">
                <span>{placeName(leg.from_place_id)} → {placeName(leg.to_place_id)}</span>
                <span className="muted">
                  {fmtDuration(leg.duration_sec)} / {fmtDistance(leg.distance_m)}
                  {leg.fare_text ? ` / ${leg.fare_text}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="card error">⚠ {error}</div>}
    </div>
  );
}
