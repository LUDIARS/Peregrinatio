import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import type { ItineraryItem, Trip, TripDay, TripPlace } from '../types.js';

type ItemsByDay = Record<string, ItineraryItem[]>;

/**
 * 旅のしおり (カンバンボード)。
 * - 列 = 旅の各日 (trip_days)、カード = その日の行動予定 (itinerary_items)。
 * - カードはドラッグ (PC) または ◀▶▲▼ ボタン (タッチ) で日をまたいで自由に並べ替えられる。
 * - 「ここに行く」から `?place=<id>` 付きで開くと配置モードになり、各列の「＋ ここに追加」で日を選ぶ。
 */
export function Itinerary() {
  const { tripId } = useParams<{ tripId: string }>();
  const [params, setParams] = useSearchParams();
  const pendingPlaceId = params.get('place');

  const [trip, setTrip] = useState<Trip | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [places, setPlaces] = useState<TripPlace[]>([]);
  const [itemsByDay, setItemsByDay] = useState<ItemsByDay>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ドラッグ中のカード {item id, 元の day id} と、ドロップ先のハイライト用 day id。
  const drag = useRef<{ itemId: string; fromDayId: string } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const placeMap = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const pendingPlace = pendingPlaceId ? placeMap.get(pendingPlaceId) ?? null : null;

  const load = async () => {
    if (!tripId) return;
    const detail = await api.getTrip(tripId);
    const sorted = [...detail.days].sort((a, b) => a.day_index - b.day_index);
    setTrip(detail.trip);
    setDays(sorted);
    setPlaces(detail.places);
    const lists = await Promise.all(sorted.map((d) => api.listItems(d.id)));
    const map: ItemsByDay = {};
    sorted.forEach((d, i) => { map[d.id] = [...(lists[i] ?? [])].sort((a, b) => a.order_index - b.order_index); });
    setItemsByDay(map);
  };

  useEffect(() => {
    (async () => {
      try { await load(); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  /** ローカルで並びを確定 → 変わった分だけ order_index / day_id を永続化 (失敗時は再読込で復旧)。 */
  const commit = async (groups: ItemsByDay, affected: string[]) => {
    const next: ItemsByDay = { ...groups };
    const patches: { id: string; day_id: string; order_index: number }[] = [];
    for (const dayId of affected) {
      next[dayId] = (groups[dayId] ?? []).map((it, i) => {
        if (it.order_index !== i || it.day_id !== dayId) {
          patches.push({ id: it.id, day_id: dayId, order_index: i });
          return { ...it, order_index: i, day_id: dayId };
        }
        return it;
      });
    }
    setItemsByDay(next);
    if (patches.length === 0) return;
    setBusy(true); setError('');
    try {
      await Promise.all(patches.map((p) => api.patchItem(p.id, { day_id: p.day_id, order_index: p.order_index })));
    } catch (e) {
      setError(e instanceof Error ? e.message : '並べ替えの保存に失敗しました');
      await load();
    } finally { setBusy(false); }
  };

  /** dragged を toDayId の beforeItemId の前に挿入 (beforeItemId=null で末尾)。同日内の並べ替えも兼ねる。 */
  const moveItemBefore = (itemId: string, fromDayId: string, toDayId: string, beforeItemId: string | null) => {
    if (beforeItemId === itemId) return;
    const item = (itemsByDay[fromDayId] ?? []).find((x) => x.id === itemId);
    if (!item) return;
    const from = (itemsByDay[fromDayId] ?? []).filter((x) => x.id !== itemId);
    const groups: ItemsByDay = { ...itemsByDay, [fromDayId]: from };
    const to = fromDayId === toDayId ? from : [...(itemsByDay[toDayId] ?? [])];
    let idx = beforeItemId == null ? to.length : to.findIndex((x) => x.id === beforeItemId);
    if (idx < 0) idx = to.length;
    to.splice(idx, 0, item);
    groups[toDayId] = to;
    void commit(groups, fromDayId === toDayId ? [toDayId] : [fromDayId, toDayId]);
  };

  /** 隣の日へ移動 (タッチ用)。 */
  const moveToAdjacentDay = (itemId: string, fromDayId: string, dir: -1 | 1) => {
    const di = days.findIndex((d) => d.id === fromDayId);
    const target = days[di + dir];
    if (!target) return;
    moveItemBefore(itemId, fromDayId, target.id, null);
  };

  /** 同じ日の中で上下に並べ替え (タッチ用)。 */
  const reorder = (dayId: string, index: number, dir: -1 | 1) => {
    const arr = [...(itemsByDay[dayId] ?? [])];
    const j = index + dir;
    if (j < 0 || j >= arr.length) return;
    const tmp = arr[index]!; arr[index] = arr[j]!; arr[j] = tmp;
    void commit({ ...itemsByDay, [dayId]: arr }, [dayId]);
  };

  const setTime = async (item: ItineraryItem, dayId: string, time: string) => {
    const v = time || null;
    setItemsByDay((m) => ({ ...m, [dayId]: (m[dayId] ?? []).map((x) => (x.id === item.id ? { ...x, planned_time: v } : x)) }));
    try { await api.patchItem(item.id, { planned_time: v }); }
    catch (e) { setError(e instanceof Error ? e.message : '時刻の保存に失敗しました'); }
  };

  const removeItem = async (item: ItineraryItem, dayId: string) => {
    setItemsByDay((m) => ({ ...m, [dayId]: (m[dayId] ?? []).filter((x) => x.id !== item.id) }));
    try { await api.deleteItem(item.id); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); await load(); }
  };

  const addPendingToDay = async (dayId: string) => {
    if (!pendingPlaceId) return;
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, { place_id: pendingPlaceId, kind: 'visit' });
      setItemsByDay((m) => ({ ...m, [dayId]: [...(m[dayId] ?? []), it] }));
      // 配置完了 → バナーを閉じる (param を外す)。
      setParams({}, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '予定への追加に失敗しました');
    } finally { setBusy(false); }
  };

  const addDay = async () => {
    if (!tripId) return;
    setBusy(true); setError('');
    try { await api.createDay(tripId, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : '日の追加に失敗しました'); }
    finally { setBusy(false); }
  };

  if (!tripId) return null;
  if (error && !trip) return <div className="card error">⚠ {error}</div>;
  if (!trip) return <p className="muted">読み込み中…</p>;

  const onCardDragStart = (e: React.DragEvent, itemId: string, fromDayId: string) => {
    drag.current = { itemId, fromDayId };
    e.dataTransfer.effectAllowed = 'move';
  };
  const onCardDrop = (e: React.DragEvent, toDayId: string, beforeItemId: string) => {
    e.preventDefault(); e.stopPropagation();
    const d = drag.current; drag.current = null; setOverDay(null);
    if (d) moveItemBefore(d.itemId, d.fromDayId, toDayId, beforeItemId);
  };
  const onColDrop = (e: React.DragEvent, toDayId: string) => {
    e.preventDefault();
    const d = drag.current; drag.current = null; setOverDay(null);
    if (d) moveItemBefore(d.itemId, d.fromDayId, toDayId, null);
  };

  return (
    <div className="itinerary-page">
      <div className="kanban-head">
        <div className="crumb"><Link to={`/trips/${tripId}`}>← 旅へ戻る</Link></div>
        <h2 style={{ margin: 0 }}>🗓 {trip.title} — 旅のしおり</h2>
        <p className="muted" style={{ margin: 0 }}>
          カードをドラッグ、またはカードの ◀▶ で日を移動、▲▼ で並べ替えできます。
        </p>
      </div>

      {pendingPlace && (
        <div className="kanban-place-banner">
          <span>📍『{pendingPlace.name}』をどの日程に入れますか？ 各日の「＋ ここに追加」を押してください。</span>
          <button type="button" className="sm ghost" onClick={() => setParams({}, { replace: true })}>やめる</button>
        </div>
      )}
      {pendingPlaceId && !pendingPlace && (
        <div className="kanban-place-banner">
          <span className="muted">配置対象の場所が見つかりません（この旅から外された可能性があります）。</span>
          <button type="button" className="sm ghost" onClick={() => setParams({}, { replace: true })}>閉じる</button>
        </div>
      )}

      {error && <div className="card error">⚠ {error}</div>}

      {days.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>まだ日程がありません。日を追加して予定を組みましょう。</p>
          <button type="button" onClick={() => void addDay()} disabled={busy}>＋ 日を追加</button>
        </div>
      ) : (
        <div className="kanban-board">
          {days.map((d) => {
            const items = itemsByDay[d.id] ?? [];
            return (
              <section
                key={d.id}
                className={`kanban-col${overDay === d.id ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverDay(d.id); }}
                onDragLeave={() => setOverDay((cur) => (cur === d.id ? null : cur))}
                onDrop={(e) => onColDrop(e, d.id)}
              >
                <header className="kanban-col-head">
                  <div className="spread">
                    <strong>{d.title || `${d.day_index + 1} 日目`}</strong>
                    <span className="chip">{items.length}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{d.date ?? '日付未定'}</div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {pendingPlaceId && pendingPlace && (
                      <button type="button" className="sm" onClick={() => void addPendingToDay(d.id)} disabled={busy}>
                        ＋ ここに追加
                      </button>
                    )}
                    <Link to={`/trips/${tripId}/days/${d.id}`} className="sm-link">経路 →</Link>
                  </div>
                </header>

                <div className="kanban-cards">
                  {items.length === 0 && <p className="muted kanban-empty">ここにカードをドロップ</p>}
                  {items.map((it, idx) => {
                    const p = it.place_id ? placeMap.get(it.place_id) : null;
                    return (
                      <article
                        key={it.id}
                        className="kanban-card"
                        draggable
                        onDragStart={(e) => onCardDragStart(e, it.id, d.id)}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => onCardDrop(e, d.id, it.id)}
                      >
                        <div className="kanban-card-body">
                          {p?.image_url && (
                            <img className="kanban-card-thumb" src={assetUrl(p.image_url)} alt={p.name} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong className="kanban-card-name">
                              {p ? `${p.is_base === 1 ? '🏨 ' : ''}${p.name}` : (it.note || '(メモ)')}
                            </strong>
                            {p?.category && <div className="muted" style={{ fontSize: 12 }}>{p.category}</div>}
                            <input
                              type="time"
                              className="kanban-time"
                              value={it.planned_time ?? ''}
                              onChange={(e) => void setTime(it, d.id, e.target.value)}
                              aria-label="時刻"
                            />
                          </div>
                        </div>
                        <div className="kanban-card-ctrl">
                          <button type="button" className="kanban-mini" title="前の日へ"
                            disabled={busy || days.findIndex((x) => x.id === d.id) === 0}
                            onClick={() => moveToAdjacentDay(it.id, d.id, -1)}>◀</button>
                          <button type="button" className="kanban-mini" title="上へ"
                            disabled={busy || idx === 0}
                            onClick={() => reorder(d.id, idx, -1)}>▲</button>
                          <button type="button" className="kanban-mini" title="下へ"
                            disabled={busy || idx === items.length - 1}
                            onClick={() => reorder(d.id, idx, 1)}>▼</button>
                          <button type="button" className="kanban-mini" title="次の日へ"
                            disabled={busy || days.findIndex((x) => x.id === d.id) === days.length - 1}
                            onClick={() => moveToAdjacentDay(it.id, d.id, 1)}>▶</button>
                          <button type="button" className="kanban-mini danger" title="削除"
                            onClick={() => void removeItem(it, d.id)}>🗑</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="kanban-col kanban-addcol">
            <button type="button" className="ghost" onClick={() => void addDay()} disabled={busy}>＋ 日を追加</button>
          </div>
        </div>
      )}
    </div>
  );
}
