import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import { getPrefs } from '../lib/prefs.js';
import type {
  ItineraryItem, RouteLeg, RouteMode, Timetable, TimetableDeparture, Trip, TripDay, TripPlace,
} from '../types.js';

const KIND_LABEL: Record<string, string> = { shinkansen: '新幹線', bus: 'バス', train: '電車' };

/** その timetable の便を 1 行ラベル化する。 */
interface DepartureOption {
  dep: TimetableDeparture;
  timetable: Timetable;
}

type ItemsByDay = Record<string, ItineraryItem[]>;

const MODES: { value: RouteMode; label: string }[] = [
  { value: 'driving', label: '車' },
  { value: 'walking', label: '徒歩' },
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

/**
 * 旅のしおり (カンバンボード) = 日程の唯一の編集画面 (旧 DayPlanner を統合)。
 * - 列 = 旅の各日 (trip_days)、カード = その日の行動予定 (itinerary_items)。
 * - カードはドラッグ (PC) または ◀▶▲▼ ボタン (タッチ) で日をまたいで自由に並べ替えられる。
 * - 予定を変更すると各日の経路を自動再計算し、無理な経路 (区間が繋がらない等) は警告を出す。
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

  // 経路: 日ごとの leg / 移動手段 / 計算中フラグ / 警告メッセージ。
  const [legsByDay, setLegsByDay] = useState<Record<string, RouteLeg[]>>({});
  const [modeByDay, setModeByDay] = useState<Record<string, RouteMode>>({});
  const [routeBusy, setRouteBusy] = useState<Record<string, boolean>>({});
  const [routeWarn, setRouteWarn] = useState<Record<string, string>>({});

  // ドラッグ中のカード {item id, 元の day id} と、ドロップ先のハイライト用 day id。
  const drag = useRef<{ itemId: string; fromDayId: string } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  // 時刻表 (移動の候補表示用) と、移動ピッカーを開いている day id。
  const [departureOpts, setDepartureOpts] = useState<DepartureOption[]>([]);
  const [movePickerDay, setMovePickerDay] = useState<string | null>(null);

  const placeMap = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const pendingPlace = pendingPlaceId ? placeMap.get(pendingPlaceId) ?? null : null;
  const placeName = (id: string | null) => (id ? placeMap.get(id)?.name ?? '(不明)' : '(メモ)');

  const load = async () => {
    if (!tripId) return;
    const detail = await api.getTrip(tripId);
    const sorted = [...detail.days].sort((a, b) => a.day_index - b.day_index);
    setTrip(detail.trip);
    setDays(sorted);
    setPlaces(detail.places);
    const [lists, routes] = await Promise.all([
      Promise.all(sorted.map((d) => api.listItems(d.id))),
      Promise.all(sorted.map((d) => api.getRoute(d.id))),
    ]);
    const map: ItemsByDay = {};
    const legMap: Record<string, RouteLeg[]> = {};
    const modeMap: Record<string, RouteMode> = {};
    const defaultMode = getPrefs().defaultRouteMode;
    sorted.forEach((d, i) => {
      map[d.id] = [...(lists[i] ?? [])].sort((a, b) => a.order_index - b.order_index);
      const lg = routes[i] ?? [];
      legMap[d.id] = lg;
      modeMap[d.id] = lg[0]?.mode ?? defaultMode;
    });
    setItemsByDay(map);
    setLegsByDay(legMap);
    setModeByDay(modeMap);

    // 移動候補に使う時刻表の便を読み込む (拠点周辺の登録済み時刻表を横断)。
    const tts = await api.listTimetables(tripId);
    const depLists = await Promise.all(tts.map((t) => api.listDepartures(t.id)));
    const opts: DepartureOption[] = [];
    tts.forEach((t, i) => { for (const dep of depLists[i] ?? []) opts.push({ dep, timetable: t }); });
    setDepartureOpts(opts);
  };

  useEffect(() => {
    (async () => {
      try { await load(); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  /** その日の予定変更後に経路を自動再計算する。無理な経路 (区間が繋がらない) は警告を立てる。 */
  const recomputeRoute = async (dayId: string, items: ItineraryItem[], mode?: RouteMode) => {
    const m = mode ?? modeByDay[dayId] ?? 'driving';
    const placed = items.filter((i) => i.place_id);
    const coords = placed.filter((i) => {
      const p = i.place_id ? placeMap.get(i.place_id) : null;
      return p != null && p.lat != null && p.lng != null;
    });
    if (coords.length < 2) {
      setLegsByDay((s) => ({ ...s, [dayId]: [] }));
      setRouteWarn((s) => {
        const n = { ...s };
        if (placed.length >= 2 && coords.length < 2) n[dayId] = '座標付きの場所が 2 つ未満のため経路を計算できません。';
        else delete n[dayId];
        return n;
      });
      return;
    }
    setRouteBusy((s) => ({ ...s, [dayId]: true }));
    try {
      const legs = await api.computeRoute(dayId, m);
      setLegsByDay((s) => ({ ...s, [dayId]: legs }));
      const hasNull = legs.some((l) => l.duration_sec == null);
      const skipped = placed.length - coords.length;
      setRouteWarn((s) => {
        const n = { ...s };
        if (hasNull) n[dayId] = '一部区間の経路が見つかりませんでした（無理な経路の可能性があります）。';
        else if (skipped > 0) n[dayId] = `座標のない場所 ${skipped} 件を経路から除外しました。`;
        else delete n[dayId];
        return n;
      });
    } catch (e) {
      setLegsByDay((s) => ({ ...s, [dayId]: [] }));
      setRouteWarn((s) => ({ ...s, [dayId]: e instanceof Error ? `経路を計算できませんでした: ${e.message}` : '経路を計算できませんでした。' }));
    } finally {
      setRouteBusy((s) => ({ ...s, [dayId]: false }));
    }
  };

  /** ローカルで並びを確定 → 変わった分だけ order_index / day_id を永続化し、影響日の経路を再計算。 */
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
      for (const dayId of affected) void recomputeRoute(dayId, next[dayId] ?? []);
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

  const changeMode = (dayId: string, mode: RouteMode) => {
    setModeByDay((s) => ({ ...s, [dayId]: mode }));
    void recomputeRoute(dayId, itemsByDay[dayId] ?? [], mode);
  };

  const setTime = async (item: ItineraryItem, dayId: string, time: string) => {
    const v = time || null;
    setItemsByDay((m) => ({ ...m, [dayId]: (m[dayId] ?? []).map((x) => (x.id === item.id ? { ...x, planned_time: v } : x)) }));
    try { await api.patchItem(item.id, { planned_time: v }); }
    catch (e) { setError(e instanceof Error ? e.message : '時刻の保存に失敗しました'); }
  };

  const removeItem = async (item: ItineraryItem, dayId: string) => {
    const next = (itemsByDay[dayId] ?? []).filter((x) => x.id !== item.id);
    setItemsByDay((m) => ({ ...m, [dayId]: next }));
    try { await api.deleteItem(item.id); void recomputeRoute(dayId, next); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); await load(); }
  };

  const addPendingToDay = async (dayId: string) => {
    if (!pendingPlaceId) return;
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, { place_id: pendingPlaceId, kind: 'visit' });
      const next = [...(itemsByDay[dayId] ?? []), it];
      setItemsByDay((m) => ({ ...m, [dayId]: next }));
      void recomputeRoute(dayId, next);
      // 配置完了 → バナーを閉じる (param を外す)。
      setParams({}, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '予定への追加に失敗しました');
    } finally { setBusy(false); }
  };

  /** 日付のインライン編集 (日程はしおりで調整可能)。 */
  const setDayDateValue = async (dayId: string, date: string) => {
    setDays((ds) => ds.map((d) => (d.id === dayId ? { ...d, date: date || null } : d)));
    try { await api.patchDay(dayId, { date: date || null }); }
    catch (e) { setError(e instanceof Error ? e.message : '日付の保存に失敗しました'); }
  };

  /** その日の最も遅い予定時刻 (移動候補の絞り込み基準)。無ければ ''。 */
  const lastTimeOfDay = (dayId: string): string => {
    const times = (itemsByDay[dayId] ?? [])
      .map((i) => i.planned_time)
      .filter((t): t is string => !!t)
      .sort();
    return times.at(-1) ?? '';
  };

  /** 時刻表の便から移動カードを作る (時間帯が合う一覧から選択)。 */
  const addMoveFromDeparture = async (dayId: string, opt: DepartureOption) => {
    const t = opt.timetable;
    const seg = [t.from_station, t.to_station].filter(Boolean).join('→');
    const head = [KIND_LABEL[t.kind] ?? t.kind, t.line_name, opt.dep.train_name, seg].filter(Boolean).join(' ');
    const span = opt.dep.depart_time
      ? ` (${opt.dep.depart_time}${opt.dep.arrive_time ? `→${opt.dep.arrive_time}` : ''})`
      : '';
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, {
        kind: 'move', planned_time: opt.dep.depart_time || undefined, note: `${head}${span}`.trim(),
      });
      setItemsByDay((m) => ({ ...m, [dayId]: [...(m[dayId] ?? []), it] }));
      setMovePickerDay(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '移動の追加に失敗しました');
    } finally { setBusy(false); }
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
          カードをドラッグ、またはカードの ◀▶ で日を移動、▲▼ で並べ替え。並びを変えると経路を自動で再計算します。
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
          <p className="muted" style={{ marginTop: 0 }}>まだ日程がありません。旅の開始日・終了日を設定すると日程が自動で作成されます。</p>
        </div>
      ) : (
        <div className="kanban-board">
          {days.map((d) => {
            const items = itemsByDay[d.id] ?? [];
            const legs = legsByDay[d.id] ?? [];
            const totalSec = legs.reduce((s, l) => s + (l.duration_sec ?? 0), 0);
            const totalM = legs.reduce((s, l) => s + (l.distance_m ?? 0), 0);
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
                  {/* 日付はインライン編集可 (日程はしおりで調整可能)。 */}
                  <input type="date" className="kanban-day-date" value={d.date ?? ''}
                    onChange={(e) => void setDayDateValue(d.id, e.target.value)} aria-label="日付" />
                  {pendingPlaceId && pendingPlace ? (
                    <button type="button" className="sm" style={{ marginTop: 6 }}
                      onClick={() => void addPendingToDay(d.id)} disabled={busy}>
                      ＋ ここに追加
                    </button>
                  ) : (
                    <button type="button" className="sm ghost" style={{ marginTop: 6 }}
                      onClick={() => setMovePickerDay(d.id)} disabled={busy}>
                      🚃 移動を追加
                    </button>
                  )}
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

                {/* 経路フッタ: 移動手段の切替 + 区間の所要時間/距離。予定変更で自動再計算。 */}
                <div className="kanban-route">
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <select className="kanban-route-mode" value={modeByDay[d.id] ?? 'driving'}
                      onChange={(e) => changeMode(d.id, e.target.value as RouteMode)} aria-label="移動手段">
                      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    {routeBusy[d.id] && <span className="muted" style={{ fontSize: 12 }}>計算中…</span>}
                  </div>
                  {routeWarn[d.id] && <div className="kanban-route-warn">⚠ {routeWarn[d.id]}</div>}
                  {legs.length > 0 && (
                    <>
                      <div className="kanban-route-total">合計 {fmtDuration(totalSec)} / {fmtDistance(totalM)}</div>
                      {legs.map((leg) => (
                        <div key={leg.id} className="kanban-leg">
                          <span>{placeName(leg.from_place_id)} → {placeName(leg.to_place_id)}</span>
                          <span className="muted">
                            {fmtDuration(leg.duration_sec)} / {fmtDistance(leg.distance_m)}
                            {leg.fare_text ? ` / ${leg.fare_text}` : ''}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 移動ピッカー: 登録済み時刻表から「時間帯が合う便」を選んで移動カードにする。 */}
      {movePickerDay && (() => {
        const ref = lastTimeOfDay(movePickerDay);
        const cands = departureOpts
          .filter((o) => o.dep.depart_time && (!ref || (o.dep.depart_time as string) >= ref))
          .sort((a, b) => (a.dep.depart_time ?? '').localeCompare(b.dep.depart_time ?? ''));
        return (
          <div className="modal-backdrop" onClick={() => setMovePickerDay(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>🚃 移動を追加 — 時間帯が合う便</strong>
                <button type="button" className="sm ghost" onClick={() => setMovePickerDay(null)}>閉じる</button>
              </div>
              {ref && <p className="muted" style={{ margin: '4px 0' }}>{ref} 以降の便を表示しています。</p>}
              {departureOpts.length === 0 && (
                <p className="muted">時刻表が未登録です。下部メニューの「時刻表/運行情報」で便を登録してください。</p>
              )}
              {departureOpts.length > 0 && cands.length === 0 && (
                <p className="muted">条件に合う便がありません（時刻表の便を増やすか時刻を調整してください）。</p>
              )}
              <div className="stack">
                {cands.map((o, i) => (
                  <button key={`${o.dep.id}-${i}`} type="button" className="card card-link"
                    onClick={() => void addMoveFromDeparture(movePickerDay, o)} disabled={busy}>
                    <strong>{o.dep.depart_time}{o.dep.arrive_time ? ` → ${o.dep.arrive_time}` : ''}</strong>
                    <div className="muted">
                      {[KIND_LABEL[o.timetable.kind] ?? o.timetable.kind, o.timetable.line_name, o.dep.train_name]
                        .filter(Boolean).join(' ')}
                      {(o.timetable.from_station || o.timetable.to_station)
                        ? ` ｜ ${o.timetable.from_station ?? '?'}→${o.timetable.to_station ?? '?'}` : ''}
                      {o.dep.fare_text ? ` ｜ ${o.dep.fare_text}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
