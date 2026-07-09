import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import { getPrefs } from '../lib/prefs.js';
import { gmapsDirUrl } from '../lib/gmaps.js';
import { adjustOptionToTarget, hhmmToMin } from '../lib/transit-adjust.js';
import type {
  HomeLocation, ItineraryItem, OriginKind, RouteLeg, RouteMode, Timetable, TimetableDeparture,
  TransitOption, Trip, TripDay, TripPlace,
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
const MODE_META: Record<RouteMode, { label: string; icon: string }> = {
  driving: { label: '車', icon: '🚗' },
  walking: { label: '徒歩', icon: '🚶' },
  transit: { label: '公共交通', icon: '🚃' },
  bicycling: { label: '自転車', icon: '🚲' },
};

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
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [itemsByDay, setItemsByDay] = useState<ItemsByDay>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 出発地点フォーム (自宅/集合地点)。trip ロード時に同期する。
  const [oKind, setOKind] = useState<OriginKind>('none');
  const [oAddr, setOAddr] = useState('');
  const [oLabel, setOLabel] = useState('');

  // 経路: 日ごとの leg / 移動手段 / 計算中フラグ / 警告メッセージ。
  const [legsByDay, setLegsByDay] = useState<Record<string, RouteLeg[]>>({});
  const [modeByDay, setModeByDay] = useState<Record<string, RouteMode>>({});
  const [routeBusy, setRouteBusy] = useState<Record<string, boolean>>({});
  const [routeWarn, setRouteWarn] = useState<Record<string, string>>({});

  // ドラッグ中のカード {item id, 元の day id} と、ドロップ先のハイライト用 day id。
  const drag = useRef<{ itemId: string; fromDayId: string } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  // タッチ長押しドラッグ (Trello 風)。マウスは HTML5 DnD、タッチは長押し→指で移動。
  const touchRef = useRef<{ itemId: string; fromDayId: string; active: boolean; timer: number | null; startX: number; startY: number } | null>(null);
  const [touchDragId, setTouchDragId] = useState<string | null>(null);

  // 時刻表 (移動の候補表示用) と、移動ピッカーを開いている day id。
  const [departureOpts, setDepartureOpts] = useState<DepartureOption[]>([]);
  const [movePickerDay, setMovePickerDay] = useState<string | null>(null);
  const [moveFreeMode, setMoveFreeMode] = useState<RouteMode>(getPrefs().defaultRouteMode);
  const [placePickerDay, setPlacePickerDay] = useState<string | null>(null);
  const [placePickerQuery, setPlacePickerQuery] = useState('');

  // 公共交通の取り込み (暫定)。自動取得(ヘッドレス)を主、貼り付けを手動フォールバックに。
  const [fetchingLegId, setFetchingLegId] = useState<string | null>(null);
  const [legMsg, setLegMsg] = useState<Record<string, string>>({}); // leg.id -> エラー文言
  // 取得した経路候補から選ぶモーダル。
  const [optionsModal, setOptionsModal] = useState<{ dayId: string; leg: RouteLeg; options: TransitOption[] } | null>(null);
  const [optionBusy, setOptionBusy] = useState(false);
  const [targetArrive, setTargetArrive] = useState(''); // 目標到着時刻 'HH:MM' (逆算用)
  const [freeMode, setFreeMode] = useState<RouteMode>('transit');
  const [pasteTarget, setPasteTarget] = useState<{ dayId: string; leg: RouteLeg } | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState('');

  const placeMap = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const pendingPlace = pendingPlaceId ? placeMap.get(pendingPlaceId) ?? null : null;
  const placeName = (id: string | null) => (id ? placeMap.get(id)?.name ?? '(不明)' : '(メモ)');
  // 経路端点名: place なら place 名、place でない端点 (出発/帰着地点) は leg のラベル。
  const endpointName = (placeId: string | null, label: string | null) => (placeId ? placeName(placeId) : label ?? '(地点)');

  /** 区間端点 (place or 出発地点) の座標。Google マップ経路リンク用。 */
  const legEndpointCoord = (placeId: string | null): { lat: number; lng: number } | null => {
    if (placeId) {
      const p = placeMap.get(placeId);
      return p && p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
    }
    return trip && trip.origin_lat != null && trip.origin_lng != null
      ? { lat: trip.origin_lat, lng: trip.origin_lng } : null;
  };

  /** 区間 (移動) コネクタ: 場所カードと場所カードの間に手段セレクタ+所要+Googleマップ経路を表示する。
   *  手段セレクタは区間ごとに独立 (この区間だけ再計算し、他区間に連動しない)。
   *  公共交通(乗換)は API で取れないため、Google マップで経路を開けるリンクを併設する。 */
  const renderConnector = (dayId: string, leg: RouteLeg | undefined, key: string) => {
    if (!leg) return null;
    const meta = MODE_META[leg.mode];
    const detail = [fmtDuration(leg.duration_sec), fmtDistance(leg.distance_m), leg.fare_text].filter(Boolean).join(' / ');
    const from = legEndpointCoord(leg.from_place_id);
    const to = legEndpointCoord(leg.to_place_id);
    const mapUrl = from && to ? gmapsDirUrl(from, to, leg.mode) : null;
    return (
      <div key={key} className="kanban-connector" aria-label={`移動 ${meta.label}`}>
        <div className="kanban-connector-row">
          <span className="kanban-connector-ico" aria-hidden="true">{meta.icon}</span>
          <select className="kanban-connector-mode" value={leg.mode}
            onChange={(e) => void setLegMode(dayId, leg, e.target.value as RouteMode)} aria-label="この区間の移動手段">
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <span className="muted">{detail || '—'}</span>
          {mapUrl && (
            <a className="kanban-connector-link" href={mapUrl} target="_blank" rel="noreferrer"
              title="Google マップで経路を開く（公共交通の乗換もこちら）">🗺️ 経路</a>
          )}
          {/* 公共交通は API で取れないので、サーバが Google マップを開いて経路を自動取得する (暫定)。 */}
          {leg.mode === 'transit' && (
            <button type="button" className="kanban-connector-link"
              onClick={() => void fetchTransit(dayId, leg)} disabled={fetchingLegId === leg.id}
              title="Google マップの乗換経路を自動取得して取り込む">
              {fetchingLegId === leg.id ? '取得中…' : '🚉 経路を取得'}
            </button>
          )}
        </div>
        {leg.note && <div className="kanban-connector-note">🚉 {leg.note}</div>}
        {leg.mode === 'transit' && legMsg[leg.id] && (
          <div className="kanban-connector-err">
            ⚠ {legMsg[leg.id]}{' '}
            <button type="button" className="kanban-connector-link"
              onClick={() => { setPasteTarget({ dayId, leg }); setPasteText(''); setPasteMsg(''); }}>
              📋 手動で貼り付け
            </button>
          </div>
        )}
      </div>
    );
  };

  const load = async () => {
    if (!tripId) return;
    const [detail, homeSetting] = await Promise.all([
      api.getTrip(tripId),
      api.getHome().catch(() => null),
    ]);
    const sorted = [...detail.days].sort((a, b) => a.day_index - b.day_index);
    setTrip(detail.trip);
    setHome(homeSetting);
    setOKind(detail.trip.origin_kind);
    setOAddr(detail.trip.origin_kind === 'meeting' ? detail.trip.origin_address ?? '' : '');
    setOLabel(detail.trip.origin_kind === 'meeting' ? detail.trip.origin_label ?? '' : '');
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
      // 区間ごとに独立管理するため、日の値は「新規区間の既定手段」(prefs) のシードのみ。
      modeMap[d.id] = defaultMode;
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
  const recomputeRoute = async (dayId: string, items: ItineraryItem[], mode?: RouteMode, opts?: { originDay?: boolean }) => {
    const m = mode ?? modeByDay[dayId] ?? 'driving';
    const placed = items.filter((i) => i.place_id);
    const coords = placed.filter((i) => {
      const p = i.place_id ? placeMap.get(i.place_id) : null;
      return p != null && p.lat != null && p.lng != null;
    });
    // 出発地点 (自宅/集合地点) が初日/最終日に付くと、場所 1 つでも往路/復路を引けるので閾値を 1 に下げる。
    const firstDayId = days[0]?.id;
    const lastDayId = days[days.length - 1]?.id;
    const originActive = !!trip && trip.origin_kind !== 'none' && trip.origin_lat != null;
    const isOriginDay = opts?.originDay ?? (originActive && (dayId === firstDayId || dayId === lastDayId));
    const minNeeded = isOriginDay ? 1 : 2;
    if (coords.length < minNeeded) {
      setLegsByDay((s) => ({ ...s, [dayId]: [] }));
      setRouteWarn((s) => {
        const n = { ...s };
        if (placed.length >= minNeeded && coords.length < minNeeded) n[dayId] = '座標付きの場所が足りないため経路を計算できません。';
        else delete n[dayId];
        return n;
      });
      return;
    }
    setRouteBusy((s) => ({ ...s, [dayId]: true }));
    try {
      // 区間ごとに距離+「最初の移動手段(m)」から手段を自動サジェスト (autoPerSegment)。
      const legs = await api.computeRoute(dayId, m, true);
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

  /** サーバが Google マップの乗換経路を自動取得→解析し、候補を選択モーダルに出す (主経路)。 */
  const fetchTransit = async (dayId: string, leg: RouteLeg) => {
    setFetchingLegId(leg.id);
    setLegMsg((m) => { const n = { ...m }; delete n[leg.id]; return n; });
    try {
      const { options } = await api.transitFetch(leg.id);
      if (options.length === 0) { setLegMsg((m) => ({ ...m, [leg.id]: '経路候補が見つかりませんでした' })); return; }
      setFreeMode(leg.mode);
      setTargetArrive(''); setOptionsModal({ dayId, leg, options });
    } catch (e) {
      // 自動取得失敗時は手動貼り付けへ誘導する。
      setLegMsg((m) => ({ ...m, [leg.id]: e instanceof Error ? e.message : '自動取得に失敗しました' }));
    } finally { setFetchingLegId(null); }
  };

  /** 貼り付けた Google マップの乗換結果を LLM 解析し、候補を選択モーダルに出す。 */
  const submitPaste = async () => {
    if (!pasteTarget) return;
    const text = pasteText.trim();
    if (!text) { setPasteMsg('Google マップの経路結果を貼り付けてください'); return; }
    setPasteBusy(true); setPasteMsg('');
    try {
      const { options } = await api.transitFromGmaps(pasteTarget.leg.id, text);
      if (options.length === 0) { setPasteMsg('経路候補が見つかりませんでした'); return; }
      setFreeMode(pasteTarget.leg.mode);
      setTargetArrive(''); setOptionsModal({ dayId: pasteTarget.dayId, leg: pasteTarget.leg, options });
      setPasteTarget(null); setPasteText('');
    } catch (e) {
      setPasteMsg(e instanceof Error ? e.message : '解析に失敗しました');
    } finally { setPasteBusy(false); }
  };

  /** 候補を 1 つ選んでこの区間に確定する。 */
  const selectOption = async (opt: TransitOption) => {
    if (!optionsModal) return;
    setOptionBusy(true);
    try {
      const updated = await api.transitSelect(optionsModal.leg.id, opt);
      const dayId = optionsModal.dayId;
      setLegsByDay((s) => ({ ...s, [dayId]: (s[dayId] ?? []).map((l) => (l.id === updated.id ? updated : l)) }));
      setOptionsModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '経路の確定に失敗しました');
    } finally { setOptionBusy(false); }
  };

  /** 1 区間 (leg) の移動手段だけを変更する。他区間に連動しない (完全独立)。 */
  const setLegMode = async (dayId: string, leg: RouteLeg, mode: RouteMode) => {
    if (mode === leg.mode) return;
    // 楽観更新: まずその区間だけ手段を差し替える。
    setLegsByDay((s) => ({ ...s, [dayId]: (s[dayId] ?? []).map((l) => (l.id === leg.id ? { ...l, mode } : l)) }));
    try {
      const updated = await api.patchLegMode(leg.id, mode);
      setLegsByDay((s) => ({ ...s, [dayId]: (s[dayId] ?? []).map((l) => (l.id === leg.id ? updated : l)) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '区間の移動手段の変更に失敗しました');
      void recomputeRoute(dayId, itemsByDay[dayId] ?? []); // 失敗時は再計算で実体に戻す
    }
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

  const selectFreeMode = async () => {
    if (!optionsModal) return;
    setOptionBusy(true);
    try {
      await setLegMode(optionsModal.dayId, optionsModal.leg, freeMode);
      setOptionsModal(null);
    } finally { setOptionBusy(false); }
  };

  const addPlaceToDay = async (dayId: string, placeId: string, opts?: { clearPending?: boolean }) => {
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, { place_id: placeId, kind: 'visit' });
      const next = [...(itemsByDay[dayId] ?? []), it];
      setItemsByDay((m) => ({ ...m, [dayId]: next }));
      void recomputeRoute(dayId, next);
      setPlacePickerDay(null);
      setPlacePickerQuery('');
      if (opts?.clearPending) setParams({}, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '場所の追加に失敗しました');
    } finally { setBusy(false); }
  };

  const addHomeToDay = async (dayId: string) => {
    if (!tripId) return;
    if (!home) { setError('自宅が未設定です。設定ページで自宅を登録してください。'); return; }
    setBusy(true); setError('');
    try {
      let homePlace = places.find((p) => p.name === '自宅' && p.address === home.address);
      if (!homePlace) {
        homePlace = await api.addPlaceToTrip(tripId, {
          name: '自宅',
          address: home.address,
          lat: home.lat,
          lng: home.lng,
          category: '自宅',
          status: 'none',
        });
        setPlaces((prev) => (prev.some((p) => p.id === homePlace!.id) ? prev : [homePlace!, ...prev]));
      }

      const it = await api.createItem(dayId, { place_id: homePlace.id, kind: 'visit' });
      const next = [...(itemsByDay[dayId] ?? []), it];
      setItemsByDay((m) => ({ ...m, [dayId]: next }));
      void recomputeRoute(dayId, next);
      setPlacePickerDay(null);
      setPlacePickerQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '自宅の追加に失敗しました');
    } finally { setBusy(false); }
  };

  const addPendingToDay = async (dayId: string) => {
    if (!pendingPlaceId) return;
    await addPlaceToDay(dayId, pendingPlaceId, { clearPending: true });
  };

  /** 日付のインライン編集 (日程はしおりで調整可能)。 */
  const setDayDateValue = async (dayId: string, date: string) => {
    setDays((ds) => ds.map((d) => (d.id === dayId ? { ...d, date: date || null } : d)));
    try { await api.patchDay(dayId, { date: date || null }); }
    catch (e) { setError(e instanceof Error ? e.message : '日付の保存に失敗しました'); }
  };

  /** 出発地点を設定し、初日(往路)・最終日(復路)の経路を再計算する。 */
  const changeOrigin = async (kind: OriginKind, address?: string, label?: string) => {
    if (!tripId) return;
    setBusy(true); setError('');
    try {
      const t = await api.setTripOrigin(tripId, { kind, address, label });
      setTrip(t);
      setOKind(t.origin_kind);
      if (t.origin_kind === 'meeting') { setOAddr(t.origin_address ?? ''); setOLabel(t.origin_label ?? ''); }
      const ids = new Set<string>();
      const fd = days[0]?.id; const ld = days[days.length - 1]?.id;
      if (fd) ids.add(fd);
      if (ld) ids.add(ld);
      const originDay = t.origin_kind !== 'none';
      for (const id of ids) void recomputeRoute(id, itemsByDay[id] ?? [], undefined, { originDay });
    } catch (e) {
      setError(e instanceof Error ? e.message : '出発地点の設定に失敗しました');
      if (trip) setOKind(trip.origin_kind); // 失敗時はサーバ実体に戻す
    } finally { setBusy(false); }
  };

  const onOriginKind = (k: OriginKind) => {
    setOKind(k);
    if (k === 'none' || k === 'home') void changeOrigin(k); // meeting は住所入力後「保存」で確定
  };

  const saveMeeting = () => {
    if (!oAddr.trim()) { setError('集合地点の住所を入力してください'); return; }
    void changeOrigin('meeting', oAddr.trim(), oLabel.trim() || undefined);
  };

  /** その日の最も遅い予定時刻 (移動候補の絞り込み基準)。無ければ ''。 */
  const lastTimeOfDay = (dayId: string): string => {
    const times = (itemsByDay[dayId] ?? [])
      .map((i) => i.planned_time)
      .filter((t): t is string => !!t)
      .sort();
    return times.at(-1) ?? '';
  };

  const addFreeMove = async (dayId: string) => {
    const modeLabel = MODES.find((m) => m.value === moveFreeMode)?.label ?? moveFreeMode;
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, { kind: 'move', note: `自由選択（${modeLabel}）` });
      setItemsByDay((m) => ({ ...m, [dayId]: [...(m[dayId] ?? []), it] }));
      setMovePickerDay(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '移動の追加に失敗しました');
    } finally { setBusy(false); }
  };

  /** その日の算出済み経路区間から移動カードを自動サジェストして作る (時刻表が無くても使える)。 */
  const addMoveFromLeg = async (dayId: string, leg: RouteLeg) => {
    const from = endpointName(leg.from_place_id, leg.from_label);
    const to = endpointName(leg.to_place_id, leg.to_label);
    const modeLabel = MODES.find((m) => m.value === leg.mode)?.label ?? leg.mode;
    const meta = [fmtDuration(leg.duration_sec), fmtDistance(leg.distance_m), leg.fare_text]
      .filter(Boolean).join(' / ');
    const note = `${from} → ${to}（${modeLabel}${meta ? ` ${meta}` : ''}）`;
    setBusy(true); setError('');
    try {
      const it = await api.createItem(dayId, { kind: 'move', note });
      setItemsByDay((m) => ({ ...m, [dayId]: [...(m[dayId] ?? []), it] }));
      setMovePickerDay(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '移動の追加に失敗しました');
    } finally { setBusy(false); }
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

  // ── タッチ長押しドラッグ (Trello 風) ──────────────────────────────────────
  const LONG_PRESS_MS = 350;
  /** 指の座標から、ドロップ先の日と「この item の前」を求める (elementFromPoint でヒットテスト)。 */
  const dropTargetAt = (x: number, y: number): { dayId: string; beforeItemId: string | null } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const col = el?.closest('[data-day-id]') as HTMLElement | null;
    if (!col) return null;
    const dayId = col.getAttribute('data-day-id')!;
    const card = el?.closest('[data-item-id]') as HTMLElement | null;
    let beforeItemId: string | null = null;
    const draggingId = touchRef.current?.itemId;
    if (card) {
      const overId = card.getAttribute('data-item-id')!;
      if (overId !== draggingId) {
        const r = card.getBoundingClientRect();
        const arr = itemsByDay[dayId] ?? [];
        const idx = arr.findIndex((i) => i.id === overId);
        beforeItemId = y < r.top + r.height / 2 ? overId : arr[idx + 1]?.id ?? null;
      }
    }
    return { dayId, beforeItemId };
  };
  const cancelTouch = () => {
    if (touchRef.current?.timer) clearTimeout(touchRef.current.timer);
    touchRef.current = null;
    setTouchDragId(null);
    setOverDay(null);
  };
  const onCardPointerDown = (e: React.PointerEvent, itemId: string, fromDayId: string) => {
    if (e.pointerType === 'mouse') return; // マウスは HTML5 DnD を使う
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    touchRef.current = {
      itemId, fromDayId, active: false, startX: e.clientX, startY: e.clientY,
      timer: window.setTimeout(() => {
        if (touchRef.current) { touchRef.current.active = true; setTouchDragId(itemId); }
      }, LONG_PRESS_MS),
    };
  };
  const onCardPointerMove = (e: React.PointerEvent) => {
    const t = touchRef.current;
    if (!t) return;
    if (!t.active) {
      // 長押し成立前に動いたらスクロール意図とみなしキャンセル。
      if (Math.hypot(e.clientX - t.startX, e.clientY - t.startY) > 12) cancelTouch();
      return;
    }
    e.preventDefault(); // ドラッグ中はスクロールさせない
    setOverDay(dropTargetAt(e.clientX, e.clientY)?.dayId ?? null);
  };
  const onCardPointerUp = (e: React.PointerEvent) => {
    const t = touchRef.current;
    if (t?.active) {
      const tgt = dropTargetAt(e.clientX, e.clientY);
      if (tgt) moveItemBefore(t.itemId, t.fromDayId, tgt.dayId, tgt.beforeItemId);
    }
    cancelTouch();
  };
  /** タッチ操作中 (長押し待ち/移動中) の contextmenu を抑止 — Android の長押しコールアウト対策。
   *  PC の右クリックは touchRef が無いので通常どおり。 */
  const onCardContextMenu = (e: React.MouseEvent) => {
    if (touchRef.current) e.preventDefault();
  };

  return (
    <div className="itinerary-page">
      <div className="kanban-head">
        <div className="crumb"><Link to={`/trips/${tripId}`}>← 旅へ戻る</Link></div>
        <h2 style={{ margin: 0 }}>🗓 {trip.title} — 旅のしおり</h2>
        <p className="muted" style={{ margin: 0 }}>
          カードをドラッグ (PC) / 長押しして移動 (スマホ)、または ◀▶ で日を移動・▲▼ で並べ替え。並びを変えると経路を自動で再計算します。
        </p>

        {/* 出発地点 (自宅/集合地点)。初日の往路・最終日の復路を自動算出する。 */}
        <div className="card foundation-form kanban-origin" style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>🏁 出発地点</span>
            <select value={oKind} onChange={(e) => onOriginKind(e.target.value as OriginKind)} disabled={busy} aria-label="出発地点">
              <option value="none">設定しない（拠点から）</option>
              <option value="home">自宅</option>
              <option value="meeting">集合地点</option>
            </select>
            {oKind === 'meeting' && (
              <>
                <input type="text" placeholder="名称 (任意)" value={oLabel}
                  onChange={(e) => setOLabel(e.target.value)} style={{ width: 120 }} />
                <input type="text" placeholder="集合地点の住所" value={oAddr}
                  onChange={(e) => setOAddr(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <button type="button" className="sm" onClick={saveMeeting} disabled={busy || !oAddr.trim()}>保存</button>
              </>
            )}
          </div>
          {trip.origin_kind !== 'none' && trip.origin_address && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {trip.origin_label}: {trip.origin_address} から初日の往路・最終日の復路を自動算出します。
            </p>
          )}
        </div>
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
            // 場所カードの間に移動コネクタを差し込むための索引。
            const legByPair = new Map<string, RouteLeg>();
            for (const lg of legs) if (lg.from_place_id && lg.to_place_id) legByPair.set(`${lg.from_place_id}|${lg.to_place_id}`, lg);
            const inboundLeg = legs.find((l) => l.from_place_id == null && l.to_place_id != null);  // 往路 (出発地点→最初の場所)
            const outboundLeg = legs.find((l) => l.to_place_id == null && l.from_place_id != null);  // 復路 (最後の場所→帰着地点)
            // 座標のある場所 item のインデックス列 (移動コネクタの接続元/先判定用)。
            const placeIdxs = items
              .map((it, i) => ({ it, i }))
              .filter(({ it }) => it.place_id && placeMap.get(it.place_id!)?.lat != null)
              .map(({ i }) => i);
            const firstPlaceIdx = placeIdxs[0] ?? -1;
            const lastPlaceIdx = placeIdxs[placeIdxs.length - 1] ?? -1;
            const nextPlaceIdOf = (idx: number): string | null => {
              const pos = placeIdxs.indexOf(idx);
              if (pos < 0 || pos + 1 >= placeIdxs.length) return null;
              return items[placeIdxs[pos + 1]!]?.place_id ?? null;
            };
            return (
              <section
                key={d.id}
                data-day-id={d.id}
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
                  <div className="itinerary-day-actions">
                    {pendingPlaceId && pendingPlace && (
                      <button type="button" className="sm"
                        onClick={() => void addPendingToDay(d.id)} disabled={busy}>
                        ＋ ここに追加
                      </button>
                    )}
                    <button type="button" className="sm ghost"
                      onClick={() => { setPlacePickerDay(d.id); setPlacePickerQuery(''); }} disabled={busy}>
                      📍 場所を追加
                    </button>
                    <button type="button" className="sm ghost"
                      onClick={() => { setMoveFreeMode(modeByDay[d.id] ?? getPrefs().defaultRouteMode); setMovePickerDay(d.id); }} disabled={busy}>
                      🚃 移動を追加
                    </button>
                  </div>
                </header>

                <div className="kanban-cards">
                  {items.length === 0 && <p className="muted kanban-empty">ここにカードをドロップ</p>}
                  {items.map((it, idx) => {
                    const p = it.place_id ? placeMap.get(it.place_id) : null;
                    // この場所カードの後に続く「次の場所」への移動コネクタ。
                    const nextId = p ? nextPlaceIdOf(idx) : null;
                    const toNextLeg = it.place_id && nextId ? legByPair.get(`${it.place_id}|${nextId}`) : undefined;
                    return (
                      <Fragment key={it.id}>
                      {/* 往路 (出発地点 → 最初の場所) は最初の場所カードの前に置く。 */}
                      {idx === firstPlaceIdx && renderConnector(d.id, inboundLeg, `in-${it.id}`)}
                      <article
                        data-item-id={it.id}
                        className={`kanban-card${touchDragId === it.id ? ' lifting' : ''}`}
                        draggable
                        onDragStart={(e) => onCardDragStart(e, it.id, d.id)}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => onCardDrop(e, d.id, it.id)}
                        onPointerDown={(e) => onCardPointerDown(e, it.id, d.id)}
                        onPointerMove={onCardPointerMove}
                        onPointerUp={onCardPointerUp}
                        onPointerCancel={cancelTouch}
                        onContextMenu={onCardContextMenu}
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
                            {it.edited_by && <div className="muted" style={{ fontSize: 11 }}>✎ {it.edited_by}</div>}
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
                      {/* 場所 → 次の場所 の移動コネクタ。 */}
                      {renderConnector(d.id, toNextLeg, `mv-${it.id}`)}
                      {/* 復路 (最後の場所 → 帰着地点) は最後の場所カードの後に置く。 */}
                      {idx === lastPlaceIdx && renderConnector(d.id, outboundLeg, `out-${it.id}`)}
                      </Fragment>
                    );
                  })}
                </div>

                {/* 経路フッタ: 合計のみ。各区間の手段は場所カード間のコネクタで個別に変更する。 */}
                <div className="kanban-route">
                  {routeBusy[d.id] && <span className="muted" style={{ fontSize: 12 }}>計算中…</span>}
                  <div className="kanban-route-hint muted" style={{ fontSize: 11 }}>
                    区間ごとに移動手段を選べます（初回は 500m以内=徒歩 などで自動サジェスト。変更は区間ごとに独立）。
                  </div>
                  {routeWarn[d.id] && <div className="kanban-route-warn">⚠ {routeWarn[d.id]}</div>}
                  {legs.length > 0 && (
                    <div className="kanban-route-total">合計 {fmtDuration(totalSec)} / {fmtDistance(totalM)}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 場所ピッカー: 旅に追加済みの場所を、この日の訪問カードとして配置する。 */}
      {placePickerDay && (() => {
        const q = placePickerQuery.trim().toLowerCase();
        const isHomePlace = (p: TripPlace) => !!home && p.name === '自宅' && p.address === home.address;
        const homeMatches = !!home && (!q || [home.address, home.station, '自宅']
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)));
        const candidates = places
          .filter((p) => p.postponed !== 1)
          .filter((p) => !isHomePlace(p))
          .filter((p) => {
            if (!q) return true;
            return [p.name, p.category, p.address].filter(Boolean)
              .some((v) => v!.toLowerCase().includes(q));
          });
        return (
          <div className="modal-backdrop" onClick={() => setPlacePickerDay(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>📍 場所を追加</strong>
                <button type="button" className="sm ghost" onClick={() => setPlacePickerDay(null)}>閉じる</button>
              </div>
              <input
                type="search"
                value={placePickerQuery}
                onChange={(e) => setPlacePickerQuery(e.target.value)}
                placeholder="場所名・カテゴリ・住所で検索"
                aria-label="追加する場所を検索"
                style={{ margin: '8px 0 10px' }}
              />
              {!home && places.length === 0 && (
                <p className="muted">この旅にはまだ場所がありません。マップや場所一覧から先に場所を追加してください。</p>
              )}
              {home && !homeMatches && candidates.length === 0 && (
                <p className="muted">一致する場所がありません。</p>
              )}
              {!home && places.length > 0 && candidates.length === 0 && (
                <p className="muted">一致する場所がありません。</p>
              )}
              <div className="stack">
                {homeMatches && (
                  <button type="button" className="card card-link itinerary-place-option"
                    onClick={() => void addHomeToDay(placePickerDay)} disabled={busy}>
                    <span className="itinerary-place-icon" aria-hidden="true">🏠</span>
                    <span>
                      <strong>自宅</strong>
                      <span className="muted">
                        {[home.station ? `最寄り駅: ${home.station}` : null, home.address].filter(Boolean).join(' ・ ')}
                      </span>
                    </span>
                  </button>
                )}
                {candidates.map((p) => (
                  <button key={p.id} type="button" className="card card-link itinerary-place-option"
                    onClick={() => void addPlaceToDay(placePickerDay, p.id)} disabled={busy}>
                    {p.image_url && <img src={assetUrl(p.image_url)} alt="" />}
                    <span>
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {[p.is_base === 1 ? '拠点' : null, p.category, p.address].filter(Boolean).join(' ・ ')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 移動ピッカー: 経路からの自動サジェスト + 登録済み時刻表の便。 */}
      {movePickerDay && (() => {
        const ref = lastTimeOfDay(movePickerDay);
        const suggestLegs = legsByDay[movePickerDay] ?? [];
        const cands = departureOpts
          .filter((o) => o.dep.depart_time && (!ref || (o.dep.depart_time as string) >= ref))
          .sort((a, b) => (a.dep.depart_time ?? '').localeCompare(b.dep.depart_time ?? ''));
        return (
          <div className="modal-backdrop" onClick={() => setMovePickerDay(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>🚃 移動を追加</strong>
                <button type="button" className="sm ghost" onClick={() => setMovePickerDay(null)}>閉じる</button>
              </div>

              {/* 経路から自動サジェスト (その日の算出済みルート区間)。時刻表が無くても使える。 */}
              <p className="muted" style={{ margin: '8px 0 4px' }}>経路から自動サジェスト</p>
              {suggestLegs.length === 0 && (
                <p className="muted">この日の経路がまだありません（場所を2つ以上入れて移動手段を選ぶと算出されます）。</p>
              )}
              <div className="stack">
                <div className="card itinerary-free-mode">
                  <div>
                    <strong>自由選択</strong>
                    <p className="muted">経路候補にない移動を、交通機関だけ選んで追加します。</p>
                  </div>
                  <div className="row">
                    <select className="kanban-connector-mode" value={moveFreeMode}
                      onChange={(e) => setMoveFreeMode(e.target.value as RouteMode)} aria-label="自由選択の交通機関">
                      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <button type="button" className="sm" onClick={() => void addFreeMove(movePickerDay)} disabled={busy}>
                      この交通機関で追加
                    </button>
                  </div>
                </div>
                {suggestLegs.map((leg) => (
                  <button key={`leg-${leg.id}`} type="button" className="card card-link"
                    onClick={() => void addMoveFromLeg(movePickerDay, leg)} disabled={busy}>
                    <strong>{endpointName(leg.from_place_id, leg.from_label)} → {endpointName(leg.to_place_id, leg.to_label)}</strong>
                    <div className="muted">
                      {MODES.find((m) => m.value === leg.mode)?.label ?? leg.mode}
                      {` ・ ${fmtDuration(leg.duration_sec)} / ${fmtDistance(leg.distance_m)}`}
                      {leg.fare_text ? ` ・ ${leg.fare_text}` : ''}
                    </div>
                  </button>
                ))}
              </div>

              <p className="muted" style={{ margin: '12px 0 4px' }}>時刻表の便から選ぶ</p>
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

      {/* Google マップ結果の貼り付け解析 (公共交通の暫定取り込み)。 */}
      {pasteTarget && (() => {
        const leg = pasteTarget.leg;
        const from = legEndpointCoord(leg.from_place_id);
        const to = legEndpointCoord(leg.to_place_id);
        const mapUrl = from && to ? gmapsDirUrl(from, to, 'transit') : null;
        return (
          <div className="modal-backdrop" onClick={() => setPasteTarget(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>📋 Google マップの乗換結果を取り込む</strong>
                <button type="button" className="sm ghost" onClick={() => setPasteTarget(null)}>閉じる</button>
              </div>
              <p className="muted" style={{ margin: '6px 0' }}>
                {endpointName(leg.from_place_id, leg.from_label)} → {endpointName(leg.to_place_id, leg.to_label)} の区間です。
                {mapUrl && <> まず <a href={mapUrl} target="_blank" rel="noreferrer">Google マップで経路を開く</a> → 結果(所要/運賃/路線・乗換)をコピーして下に貼り付けてください。</>}
              </p>
              <textarea className="foundation-form" rows={6} value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="例: 32分 ¥320 / JR山手線(新宿→東京) → 東京メトロ丸ノ内線… 乗換1回" />
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button type="button" onClick={() => void submitPaste()} disabled={pasteBusy || !pasteText.trim()}>
                  {pasteBusy ? '解析中…' : '解析して取り込む'}
                </button>
              </div>
              {pasteMsg && <div className="error" style={{ marginTop: 6 }}>{pasteMsg}</div>}
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                ※ 日本の公共交通は経路 API で取得できないための暫定機能です（将来 ODPT に移行予定）。
              </p>
            </div>
          </div>
        );
      })()}

      {/* 経路候補の選択。目標到着時刻を入れると、運行間隔から「間に合う最も遅い便」に逆算する。 */}
      {optionsModal && (() => {
        const { leg, options } = optionsModal;
        const targetMin = hhmmToMin(targetArrive);
        // 表示候補: 目標があれば各候補を逆算し、出発が遅い順 (=なるべく遅く出る)。無ければ到着が早い順 (元の順)。
        const rows = options.map((o) => ({ base: o, adj: targetMin != null ? adjustOptionToTarget(o, targetMin) : null }));
        const display = targetMin != null
          ? [...rows].sort((a, b) => {
              const da = hhmmToMin((a.adj ?? a.base).depart_time) ?? -1;
              const db = hhmmToMin((b.adj ?? b.base).depart_time) ?? -1;
              return db - da;
            })
          : rows;
        return (
          <div className="modal-backdrop" onClick={() => setOptionsModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>🚉 経路を選ぶ</strong>
                <button type="button" className="sm ghost" onClick={() => setOptionsModal(null)}>閉じる</button>
              </div>
              <p className="muted" style={{ margin: '4px 0 6px' }}>
                {endpointName(leg.from_place_id, leg.from_label)} → {endpointName(leg.to_place_id, leg.to_label)}。どのパターンで行くか選んでください。
              </p>
              <div className="card itinerary-free-mode">
                <div>
                  <strong>自由選択</strong>
                  <p className="muted">自動候補を使わず、この区間の交通機関だけを設定します。</p>
                </div>
                <div className="row">
                  <select className="kanban-connector-mode" value={freeMode}
                    onChange={(e) => setFreeMode(e.target.value as RouteMode)} aria-label="自由選択の交通機関">
                    {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <button type="button" className="sm" onClick={() => void selectFreeMode()} disabled={optionBusy}>
                    この交通機関にする
                  </button>
                </div>
              </div>
              {/* 目標到着時刻からの逆算 (運行間隔ベース)。 */}
              <div className="foundation-form" style={{ margin: '0 0 8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  🎯 目標到着時刻
                  <input type="time" value={targetArrive} onChange={(e) => setTargetArrive(e.target.value)} style={{ width: 120 }} />
                  {targetArrive && (
                    <button type="button" className="sm ghost" onClick={() => setTargetArrive('')}>クリア</button>
                  )}
                </label>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                  {targetMin != null
                    ? '運行間隔から、目標までに着く最も遅い便に逆算しています（概算）。'
                    : '入れると到着時刻から逆算して出発便を提案します。空なら到着が早い順。'}
                </p>
              </div>
              <div className="stack">
                {display.map(({ base, adj }, i) => {
                  const shown = adj ?? base;
                  const adjusted = !!adj;
                  return (
                    <button key={i} type="button" className="card card-link" disabled={optionBusy}
                      onClick={() => void selectOption(shown)}>
                      <div className="spread">
                        <strong>
                          {shown.depart_time && shown.arrive_time ? `${shown.depart_time} → ${shown.arrive_time}` : (shown.summary || '経路')}
                        </strong>
                        {targetMin == null && i === 0 && <span className="chip status-visited">到着最速</span>}
                        {targetMin != null && i === 0 && <span className="chip status-visited">おすすめ</span>}
                      </div>
                      <div className="muted" style={{ marginTop: 2 }}>
                        {[
                          base.duration_min != null ? `${base.duration_min}分` : null,
                          base.fare_yen != null ? `¥${base.fare_yen.toLocaleString('ja-JP')}` : null,
                          base.interval_min != null ? `約${base.interval_min}分間隔` : null,
                        ].filter(Boolean).join(' ・ ')}
                      </div>
                      {targetMin != null && !adjusted && (
                        <div className="muted" style={{ marginTop: 2 }}>※ 運行間隔不明のため逆算できません（取得時刻の便）</div>
                      )}
                      {base.summary && <div className="muted" style={{ marginTop: 2 }}>{base.summary}</div>}
                    </button>
                  );
                })}
              </div>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                ※ Google マップ取得→LLM 解析の暫定機能です（将来 ODPT に移行予定）。
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
