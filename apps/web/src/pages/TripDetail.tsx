import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl, pdfUrl } from '../api.js';
import type { PlaceJobView, PlaceStatus, TripDetail as TripDetailData, TripPlace } from '../types.js';

const STATUS_LABEL: Record<string, string> = { interested: '気になる', visited: '訪問済み' };
const JOB_STATUS_LABEL: Record<string, string> = {
  pending: '待機中', processing: '処理中', needs_info: '情報不足', failed: '失敗', done: '完了',
};
type StatusFilter = 'all' | PlaceStatus;
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'interested', label: '気になる' },
  { key: 'visited', label: '訪問済み' },
];
import { loadMaps, PIN_PATH } from '../lib/maps.js';
import { acquireMap, releaseMap, needsCentering, markCentered, clearMarkers, addMarker } from '../lib/mapInstance.js';
import { getCachedTrip, fetchTrip } from '../lib/dataCache.js';
import { getPrefs } from '../lib/prefs.js';
import { PlaceDetailPane } from './PlaceDetail.js';
import { Itinerary } from './Itinerary.js';
import { LibraryPicker } from './LibraryPicker.js';
import { MapSearchOverlay } from '../components/MapSearchOverlay.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type MapStatus = 'loading' | 'disabled' | 'ready' | 'error';

// 周囲 ~10-30km を見せたいので低めのズームに。z11≈横20km / z10≈横40km。
const BASE_ZOOM = 11; // 拠点クリック/フォーカス時
const AREA_ZOOM = 11; // 初期 (拠点中心の周辺)

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TripDetailData | null>(null);
  const [error, setError] = useState('');
  // 旅のしおり: PC は移動可能なオーバーレイウインドウ、モバイルは専用ルートへ遷移。
  const [showItinerary, setShowItinerary] = useState(false);
  const openItinerary = () => {
    if (window.matchMedia('(min-width: 900px)').matches) setShowItinerary(true);
    else navigate(`/trips/${tripId}/itinerary`);
  };

  // しおりウインドウの位置 (左上座標)。初期は画面中央寄せ。ドラッグで移動・保持する。
  const [winPos, setWinPos] = useState(() => {
    const w = Math.min(960, window.innerWidth * 0.92);
    const h = Math.min(window.innerHeight * 0.8, 760);
    return { x: Math.max(8, (window.innerWidth - w) / 2), y: Math.max(8, (window.innerHeight - h) / 2) };
  });
  const winDrag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const onWinBarPointerDown = (e: React.PointerEvent) => {
    // 閉じる等のボタン上では掴まない。
    if ((e.target as HTMLElement).closest('button')) return;
    winDrag.current = { startX: e.clientX, startY: e.clientY, baseX: winPos.x, baseY: winPos.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onWinBarPointerMove = (e: React.PointerEvent) => {
    const d = winDrag.current;
    if (!d) return;
    // タイトルバーが必ず掴める範囲に収める (画面外に消さない)。
    const x = Math.min(Math.max(0, d.baseX + (e.clientX - d.startX)), window.innerWidth - 120);
    const y = Math.min(Math.max(0, d.baseY + (e.clientY - d.startY)), window.innerHeight - 48);
    setWinPos({ x, y });
  };
  const onWinBarPointerUp = () => { winDrag.current = null; };

  const mapRef = useRef<HTMLDivElement | null>(null); // 地図をぶら下げるホスト要素
  const mapObj = useRef<any>(null);
  const infoObj = useRef<any>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null); // 保持している地図 DOM (付け替え用)
  const markerById = useRef<Map<string, any>>(new Map()); // placeId → marker (情報窓のアンカー用)
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [mapError, setMapError] = useState('');
  const [activeBaseId, setActiveBaseId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 地図ピン/一覧の強調用。詳細を開く selectedId とは分離し、フォーカス (スマホのタップ) でも強調する。
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // スマホ: 情報窓 (ピン上に出す名前+詳細ボタン) を表示する place。詳細を開くと閉じる。
  const [infoPlaceId, setInfoPlaceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => getPrefs().defaultStatusFilter);
  const [recommending, setRecommending] = useState(false);
  const [recommendMsg, setRecommendMsg] = useState('');
  const [recommendRadius, setRecommendRadius] = useState(8000);

  // 取り込みキュー (画像解析/クロールの順次処理)。3 秒ごとにポーリングして進捗を表示する。
  const [jobs, setJobs] = useState<PlaceJobView[]>([]);
  const prevActiveJobs = useRef(0);

  // 拠点を追加するピッカー (場所リストから選ぶ)。
  const [showBasePicker, setShowBasePicker] = useState(false);

  const reload = async () => {
    if (!tripId) return;
    try { setData(await fetchTrip(tripId)); }
    catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
  };
  useEffect(() => {
    // キャッシュがあれば即表示 (タブ切替のちらつき防止) → 裏で最新取得して差し替え。
    if (tripId) setData(getCachedTrip(tripId) ?? null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // 取り込みキューのポーリング。ジョブが完了 (active が減った) ら場所リストを再読込して
  // 成立した場所を一覧に反映する。
  const loadJobs = async () => {
    if (!tripId) return;
    try {
      const js = await api.listJobs(tripId);
      setJobs(js);
      const active = js.filter((j) => j.status === 'pending' || j.status === 'processing').length;
      if (active < prevActiveJobs.current) void reload();
      prevActiveJobs.current = active;
    } catch { /* ポーリングの失敗は無視 (次回再試行) */ }
  };
  useEffect(() => {
    void loadJobs();
    const t = window.setInterval(() => void loadJobs(), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // 地図初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.mapConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.apiKey) { setMapStatus('disabled'); return; }
        await loadMaps(cfg.apiKey);
        if (cancelled || !mapRef.current) return;
        // 保持している地図インスタンスを取得 (初回のみ生成)、ホストへ付け替える。
        const { map, info, div } = acquireMap({
          center: { lat: 35.681, lng: 139.767 }, zoom: 11,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        });
        mapObj.current = map;
        infoObj.current = info;
        mapDivRef.current = div;
        mapRef.current.appendChild(div);
        // ホスト付け替え後はサイズ再計算を促す (タイルは再取得されない)。
        window.google.maps.event.trigger(map, 'resize');
        setMapStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : '地図の初期化に失敗しました');
          setMapStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      releaseMap(); // 地図 DOM をホストから外して保持 (再生成・タイル再取得しない)。
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 詳細ペーンの開閉で地図サイズが変わるので resize を通知。
  useEffect(() => {
    if (mapStatus === 'ready' && mapObj.current && window.google) {
      const t = setTimeout(() => window.google.maps.event.trigger(mapObj.current, 'resize'), 260);
      return () => clearTimeout(t);
    }
  }, [selectedId, mapStatus]);

  const focusBase = (p: TripPlace) => {
    if (!mapObj.current || p.lat == null || p.lng == null) return;
    setActiveBaseId(p.id);
    mapObj.current.panTo({ lat: p.lat, lng: p.lng });
    mapObj.current.setZoom(BASE_ZOOM);
  };

  const fitAll = () => {
    if (!mapObj.current || !data) return;
    const g = window.google;
    const pinned = data.places.filter((p) => p.lat != null && p.lng != null && p.postponed !== 1);
    if (pinned.length === 0) return;
    const b = new g.maps.LatLngBounds();
    for (const p of pinned) b.extend({ lat: p.lat as number, lng: p.lng as number });
    mapObj.current.fitBounds(b);
    setActiveBaseId(null);
  };

  /** 場所を選択 = 詳細を開く + ピン強調 + 地図を寄せる。情報窓は閉じる。モバイルはドロワーを閉じる。 */
  const selectPlace = (p: TripPlace) => {
    setSelectedId(p.id);
    setFocusedId(p.id);
    setInfoPlaceId(null); // 詳細を開くのでピン上の情報窓は閉じる
    setDrawerOpen(false);
    // 場所選択は中心を寄せるだけ (周辺が見える広域ズームは維持。寄り過ぎ防止)。
    if (mapObj.current && p.lat != null && p.lng != null) {
      mapObj.current.panTo({ lat: p.lat, lng: p.lng });
      if (mapObj.current.getZoom() < 10) mapObj.current.setZoom(BASE_ZOOM);
    }
  };

  /** 詳細を開かずにピンを選択状態 (強調 + ピン上に情報窓) にする (スマホの通常タップ用)。 */
  const focusPlace = (p: TripPlace) => {
    setFocusedId(p.id);
    setInfoPlaceId(p.id); // ピンの上に情報窓 (名前 + 詳細ボタン) を出す
    setDrawerOpen(false);
    if (mapObj.current && p.lat != null && p.lng != null) {
      mapObj.current.panTo({ lat: p.lat, lng: p.lng });
      if (mapObj.current.getZoom() < 12) mapObj.current.setZoom(BASE_ZOOM);
    }
  };

  /** ピン上の情報窓の中身 (名前 + カテゴリ + 詳細ボタン) を DOM で作る。 */
  const buildPinInfoContent = (p: TripPlace): HTMLElement => {
    const root = document.createElement('div');
    root.className = 'pin-info';
    const name = document.createElement('div');
    name.className = 'pin-info-name';
    name.textContent = `${p.is_base === 1 ? '🏨 ' : ''}${p.name}`;
    root.appendChild(name);
    if (p.category) {
      const cat = document.createElement('div');
      cat.className = 'pin-info-cat';
      cat.textContent = p.category;
      root.appendChild(cat);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pin-info-btn';
    btn.textContent = '詳細を開く';
    btn.addEventListener('click', () => selectPlace(p));
    root.appendChild(btn);
    return root;
  };

  // スマホ判定 (PC は従来どおりタップで詳細を開く / スマホはタップ=ピン移動・長押し/ボタン=詳細)。
  const isMobile = () => window.matchMedia('(max-width: 899px)').matches;
  // 行の長押し検出 (スマホ)。長押し成立で詳細、直後の click は抑止する。
  const rowPress = useRef<{ timer: number | null; moved: boolean; x: number; y: number } | null>(null);
  const suppressRowClick = useRef(false);
  const onRowPointerDown = (e: React.PointerEvent, p: TripPlace) => {
    if (e.pointerType === 'mouse') return; // PC はマウス click で処理
    rowPress.current = {
      moved: false, x: e.clientX, y: e.clientY,
      timer: window.setTimeout(() => {
        if (rowPress.current && !rowPress.current.moved) {
          suppressRowClick.current = true;
          selectPlace(p);
        }
      }, 500),
    };
  };
  const onRowPointerMove = (e: React.PointerEvent) => {
    const r = rowPress.current;
    if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) > 10) r.moved = true;
  };
  const onRowPointerUp = () => {
    if (rowPress.current?.timer) clearTimeout(rowPress.current.timer);
    rowPress.current = null;
  };
  /** 行タップ: スマホ=ピンへ移動 / PC=詳細。長押し直後の click は無視。 */
  const onRowTap = (p: TripPlace) => {
    if (suppressRowClick.current) { suppressRowClick.current = false; return; }
    if (isMobile()) focusPlace(p); else selectPlace(p);
  };

  // ピン描画
  useEffect(() => {
    if (mapStatus !== 'ready' || !mapObj.current || !data) return;
    const g = window.google;
    clearMarkers();
    markerById.current.clear();
    const pinned = data.places.filter((p) => p.lat != null && p.lng != null && p.postponed !== 1);
    const bases = pinned.filter((p) => p.is_base === 1);

    for (const p of pinned) {
      const isBase = p.is_base === 1;
      const isSelected = p.id === focusedId; // フォーカス/選択中はピンの色を変える (強調)
      const pos = { lat: p.lat as number, lng: p.lng as number };
      const marker = new g.maps.Marker({
        position: pos, map: mapObj.current, title: p.name,
        zIndex: isSelected ? 2000 : isBase ? 1000 : 1,
        label: isBase ? { text: '🏨', fontSize: '14px' } : undefined,
        icon: {
          path: PIN_PATH,
          // 選択中=マゼンタ / 拠点=オレンジ / 通常=ティール
          fillColor: isSelected ? '#d6336c' : isBase ? '#e8590c' : '#0e7c86',
          fillOpacity: 0.95, strokeColor: '#fff',
          strokeWeight: isSelected ? 2.5 : isBase ? 2 : 1.5,
          scale: isSelected ? 1.5 : isBase ? 1.7 : 1,
          labelOrigin: new g.maps.Point(0, -26),
          anchor: new g.maps.Point(0, 0),
        },
      });
      marker.addListener('click', () => {
        // スマホ: ピンタップ=強調+情報窓 / PC: 拠点はズーム・その他は詳細。
        if (isMobile()) { focusPlace(p); }
        else if (isBase) { focusBase(p); }
        else { selectPlace(p); }
      });
      markerById.current.set(p.id, marker);
      addMarker(marker);
    }

    // スマホ: フォーカスした場所のピン上に情報窓 (名前 + 詳細ボタン) を出す。それ以外は閉じる。
    if (infoObj.current) {
      const target = isMobile() && infoPlaceId ? pinned.find((x) => x.id === infoPlaceId) : null;
      const marker = target ? markerById.current.get(target.id) : null;
      if (target && marker) {
        infoObj.current.setContent(buildPinInfoContent(target));
        infoObj.current.open({ anchor: marker, map: mapObj.current });
      } else {
        infoObj.current.close();
      }
    }

    // 自動センタリングはこの旅で 1 回だけ (同じ旅に戻った時はユーザの操作位置を保つ)。
    if (tripId && needsCentering(tripId) && pinned.length > 0) {
      markCentered(tripId);
      if (bases.length > 0) {
        const b0 = bases[0]!;
        setActiveBaseId(b0.id);
        mapObj.current.panTo({ lat: b0.lat as number, lng: b0.lng as number });
        mapObj.current.setZoom(AREA_ZOOM);
      } else { fitAll(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mapStatus, focusedId, infoPlaceId]);

  const collectRecommendations = async () => {
    if (!tripId) return;
    setRecommending(true); setRecommendMsg('');
    try {
      const { added } = await api.recommendTrip(tripId, { radius: recommendRadius });
      setRecommendMsg(added.length > 0 ? `おすすめを ${added.length} 件追加しました。` : '新しいおすすめは見つかりませんでした。');
      await reload();
    } catch (e) {
      setRecommendMsg(e instanceof Error ? e.message : 'おすすめの収集に失敗しました（拠点が未設定の可能性があります）');
    } finally { setRecommending(false); }
  };

  /** 「また今度」フラグ切替 (旅ごと)。場所リストから隔離 / 復帰させる。楽観更新→失敗時リロード。 */
  const setPostpone = async (p: TripPlace, v: boolean) => {
    if (!tripId) return;
    setData((d) => (d ? { ...d, places: d.places.map((x) => (x.id === p.id ? { ...x, postponed: v ? 1 : 0 } : x)) } : d));
    if (selectedId === p.id) setSelectedId(null);
    try { await api.setPostponed(tripId, p.id, v); }
    catch (e) { setError(e instanceof Error ? e.message : '「また今度」の切替に失敗しました'); await reload(); }
  };

  /** キューのジョブを再実行する (情報不足/失敗から pending へ)。 */
  const retryJob = async (id: string) => {
    try { await api.retryJob(id); await loadJobs(); }
    catch (e) { setError(e instanceof Error ? e.message : '再試行に失敗しました'); }
  };
  /** キューのジョブを破棄する (未成立のドラフト場所も掃除される)。 */
  const dismissJob = async (id: string) => {
    try { await api.deleteJob(id); await loadJobs(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '破棄に失敗しました'); }
  };

  /** 選んだ場所をこの旅の拠点にする (拠点を追加ピッカーから)。 */
  const makeBase = async (placeId: string) => {
    if (!tripId) return;
    try { await api.setTripBase(tripId, placeId, 1); setShowBasePicker(false); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '拠点の設定に失敗しました'); }
  };

  if (!tripId) return null;
  if (error && !data) return <div className="card error">⚠ {error}</div>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const { trip, places } = data;
  const bases = places.filter((p) => p.is_base === 1 && p.lat != null && p.lng != null);
  // 「また今度」は場所リスト/地図から隔離し、専用セクションにだけ出す。
  const activePlaces = places.filter((p) => p.postponed !== 1);
  const postponedPlaces = places.filter((p) => p.postponed === 1);
  const visiblePlaces = statusFilter === 'all' ? activePlaces : activePlaces.filter((p) => p.status === statusFilter);

  return (
    <div className={`trip-ws${selectedId ? ' has-detail' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      {/* モバイル用トップバー (☰ で一覧をスライドイン) */}
      <div className="ws-topbar">
        <button type="button" className="drawer-toggle" onClick={() => setDrawerOpen((o) => !o)} aria-label="場所一覧">☰ 一覧</button>
        <span className="ws-trip-title">{trip.title}</span>
        <button type="button" className="icon-btn" aria-label="旅のしおり" onClick={openItinerary}>🗓</button>
        <a href={pdfUrl(trip.id)} target="_blank" rel="noreferrer" className="icon-btn" aria-label="PDF">📄</a>
      </div>

      {/* 左: 場所一覧 (マスター)。PC=固定カラム / モバイル=ドロワー */}
      <aside className="ws-list">
        <div className="crumb"><Link to="/">← 旅一覧</Link></div>
        <div className="spread">
          <h2 style={{ margin: 0 }}>{trip.title}</h2>
          <a href={pdfUrl(trip.id)} target="_blank" rel="noreferrer"><button type="button" className="sm">📄 PDF</button></a>
        </div>
        <p className="muted">{trip.start_date ?? '日付未定'}{trip.end_date ? ` 〜 ${trip.end_date}` : ''}</p>

        <h3>ピン / 場所 ({places.length})</h3>
        {/* 拠点が未設定なら促す (旅は拠点ありきで設計)。 */}
        {bases.length === 0 && (
          <div className="base-setup-note">
            🏨 拠点が未設定です。宿泊地などを地図の検索から追加し、下の「拠点を追加」で設定しましょう。
          </div>
        )}
        {/* 状態フィルタ (情報過多対策): すべて / 気になる / 訪問済み */}
        {places.length > 0 && (
          <div className="base-bar">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} type="button"
                className={statusFilter === f.key ? 'chip-btn active' : 'chip-btn'}
                onClick={() => setStatusFilter(f.key)}>{f.label}</button>
            ))}
          </div>
        )}
        {places.length === 0 && <p className="muted">まだ場所がありません。地図右の検索から追加してください。</p>}
        {places.length > 0 && visiblePlaces.length === 0 && (
          <p className="muted">この状態の場所はありません。</p>
        )}
        <div className="stack">
          {visiblePlaces.map((p: TripPlace) => (
            <div key={p.id}
              className={`place-row${p.is_base === 1 ? ' is-base' : ''}${focusedId === p.id ? ' selected' : ''}`}>
              <button type="button" className="place-row-main"
                onClick={() => onRowTap(p)}
                onPointerDown={(e) => onRowPointerDown(e, p)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  {p.image_url && (
                    <img className="thumb" src={assetUrl(p.image_url)} alt={p.name}
                      style={{ width: 56, aspectRatio: '1 / 1', flex: '0 0 auto' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="spread">
                      <strong>{p.is_base === 1 ? '🏨 ' : ''}{p.name}</strong>
                      {/* 位置インジケータ。PC のみ表示 (スマホは右の「詳細」ボタンに置き換え)。 */}
                      {p.lat != null && p.lng != null
                        ? <span className="chip pin-indicator">📍</span>
                        : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      {p.status !== 'none' && STATUS_LABEL[p.status] && (
                        <span className={`chip status-${p.status}`}>
                          {STATUS_LABEL[p.status]}{p.status_by ? ` · ${p.status_by}` : ''}
                        </span>
                      )}
                      {p.category && <span className="muted">{p.category}</span>}
                    </div>
                  </div>
                </div>
              </button>
              {/* スマホのみ: 通常タップはピン移動なので、詳細は明示ボタンで開く。 */}
              <div className="place-row-actions mobile-only">
                <button type="button" className="place-row-detail-btn"
                  onClick={() => selectPlace(p)}>詳細を開く</button>
              </div>
            </div>
          ))}
        </div>

        {/* 拠点を追加 (場所リストの最後)。旅は通常 1 拠点なので、場所から選んで拠点にする。 */}
        <button type="button" className="card card-link add-base-btn" onClick={() => setShowBasePicker(true)}>
          <strong>🏨 拠点を追加</strong>
          <div className="muted">場所リストから宿泊地などを選んで拠点に設定します。</div>
        </button>

        {/* 「また今度」リスト (旅ごとに隔離した場所)。折りたたみで一覧から邪魔しない。 */}
        {postponedPlaces.length > 0 && (
          <details className="postponed-box">
            <summary>🕓 また今度 ({postponedPlaces.length})</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {postponedPlaces.map((p: TripPlace) => (
                <div key={p.id} className="place-row postponed">
                  <button type="button" className="place-row-main" onClick={() => selectPlace(p)}>
                    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
                      {p.image_url && (
                        <img className="thumb" src={assetUrl(p.image_url)} alt={p.name}
                          style={{ width: 40, aspectRatio: '1 / 1', flex: '0 0 auto' }} />
                      )}
                      <strong style={{ flex: 1, minWidth: 0 }}>{p.name}</strong>
                    </div>
                  </button>
                  <div className="place-row-actions">
                    <button type="button" className="sm ghost" title="一覧に戻す"
                      onClick={() => void setPostpone(p, false)}>戻す</button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* 近くのおすすめを収集 (左メニュー最下部) */}
        <div className="card foundation-form">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            半径
            <input
              type="number" min={500} max={50000} step={500}
              value={recommendRadius}
              onChange={(e) => setRecommendRadius(Number(e.target.value))}
              style={{ width: 72 }}
            />
            m
          </label>
          <button type="button" onClick={() => void collectRecommendations()} disabled={recommending}>
            {recommending ? '収集中…' : '📍 近くのおすすめを収集'}
          </button>
          {recommendMsg && <div className="muted">{recommendMsg}</div>}
          <p className="muted" style={{ margin: 0 }}>拠点の周辺から候補を探してこの旅に追加します（拠点の設定が必要です）。</p>
        </div>

        {/* 取り込みキュー (画像解析/クロールの順次処理)。おすすめ収集の直下に置く。 */}
        {(() => {
          const queue = jobs.filter((j) => j.status !== 'done');
          const working = queue.some((j) => j.status === 'pending' || j.status === 'processing');
          return (
            <div className="card import-queue">
              <div className="spread">
                <strong>📥 取り込みキュー</strong>
                {working && <span className="muted" style={{ fontSize: 12 }}>処理中…</span>}
              </div>
              {queue.length === 0 && (
                <p className="muted" style={{ margin: '6px 0 0' }}>取り込み中の項目はありません。</p>
              )}
              <div className="stack" style={{ marginTop: 8 }}>
                {queue.map((j) => (
                  <div key={j.id} className={`queue-row queue-${j.status}`}>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span>{j.kind === 'image' ? '🖼' : '🌐'}</span>
                      <strong style={{ flex: 1, minWidth: 0 }}>{j.place_name || '(無題)'}</strong>
                      <span className={`chip qstat-${j.status}`}>{JOB_STATUS_LABEL[j.status] ?? j.status}</span>
                    </div>
                    {j.status === 'needs_info' && j.missing_info && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>不足: {j.missing_info}</div>
                    )}
                    {j.status === 'failed' && j.error && (
                      <div className="error" style={{ fontSize: 12, marginTop: 4 }}>⚠ {j.error}</div>
                    )}
                    {(j.status === 'needs_info' || j.status === 'failed') && (
                      <div className="place-row-actions" style={{ marginTop: 6 }}>
                        {j.status === 'needs_info' && (
                          <button type="button" className="sm ghost"
                            onClick={() => { setSelectedId(j.place_id); setFocusedId(j.place_id); setDrawerOpen(false); }}>開いて補足</button>
                        )}
                        <button type="button" className="sm ghost" onClick={() => void retryJob(j.id)}>再試行</button>
                        <button type="button" className="sm ghost" onClick={() => void dismissJob(j.id)}>破棄</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </aside>

      {/* 中央: 地図 + 拠点バー + 検索 */}
      <section className="ws-map">
        {mapStatus === 'ready' && (
          <div className="base-bar">
            <span className="base-bar-label">拠点:</span>
            {bases.length === 0 && <span className="muted">未設定 — 一覧で「拠点にする」</span>}
            {bases.map((b) => (
              <button key={b.id} type="button"
                className={activeBaseId === b.id ? 'chip-btn active' : 'chip-btn'}
                onClick={() => focusBase(b)}>🏨 {b.name}</button>
            ))}
            {places.some((p) => p.lat != null) && (
              <button type="button" className="chip-btn ghost" onClick={fitAll}>全体表示</button>
            )}
          </div>
        )}
        {mapStatus === 'disabled' && <div className="card">地図の API キーが未設定です（地図以外は利用可）。</div>}
        {mapStatus === 'error' && <div className="card error">⚠ {mapError}</div>}
        <div className="map-wrap">
          <div ref={mapRef} className="map-canvas" style={{ display: mapStatus === 'disabled' ? 'none' : 'block' }} />
          {/* 場所を検索 — 地図の上にオーバーレイ。結果も地図に重ねて表示。 */}
          <MapSearchOverlay
            tripId={tripId}
            center={bases[0] ? { lat: bases[0].lat as number, lng: bases[0].lng as number } : null}
            onChanged={reload}
          />
        </div>

        {/* 既存ライブラリ場所の使い回し (他の旅で登録済みの場所をこの旅にも紐付け) */}
        <LibraryPicker
          tripId={tripId}
          existingIds={new Set(places.map((p) => p.id))}
          onAdded={reload}
        />

        <p className="muted" style={{ marginTop: 6 }}>
          ピンタップで詳細（🏨拠点はズーム）。URL/画像からの情報追加は下部メニューの「情報追加」へ。
        </p>
      </section>

      {/* 右: 場所詳細 (PC=カラム / モバイル=ポップアップ) */}
      {selectedId && (
        <aside className="ws-detail">
          <PlaceDetailPane tripId={tripId} placeId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
        </aside>
      )}

      {/* モバイル: ドロワー背景 */}
      <div className="ws-backdrop" onClick={() => setDrawerOpen(false)} />

      {/* 旅のしおり (PC オーバーレイ)。モバイルは専用ルートへ遷移するのでここには出ない。 */}
      {showItinerary && (
        <div className="itinerary-overlay" role="dialog" aria-label="旅のしおり"
          style={{ left: winPos.x, top: winPos.y }}>
          <div className="itinerary-overlay-bar"
            onPointerDown={onWinBarPointerDown}
            onPointerMove={onWinBarPointerMove}
            onPointerUp={onWinBarPointerUp}
            onPointerCancel={onWinBarPointerUp}>
            <strong>🗓 旅のしおり</strong>
            <button type="button" className="icon-btn" onClick={() => setShowItinerary(false)} aria-label="閉じる">✕</button>
          </div>
          <div className="itinerary-overlay-body">
            <Itinerary />
          </div>
        </div>
      )}

      {/* 拠点を追加ピッカー: この旅の (位置のある) 場所から拠点を選ぶ。 */}
      {showBasePicker && (() => {
        const choices = activePlaces.filter((p) => p.lat != null && p.lng != null && p.is_base !== 1);
        return (
          <div className="modal-backdrop" onClick={() => setShowBasePicker(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="spread">
                <strong>🏨 拠点を選ぶ</strong>
                <button type="button" className="sm ghost" onClick={() => setShowBasePicker(false)}>閉じる</button>
              </div>
              <p className="muted" style={{ margin: '4px 0 8px' }}>
                この旅の場所から拠点（宿泊地など）を選びます。位置情報のある場所のみ表示します。
              </p>
              {choices.length === 0 && (
                <p className="muted">選べる場所がありません。地図の検索から宿泊地などを追加してください。</p>
              )}
              <div className="stack">
                {choices.map((p) => (
                  <button key={p.id} type="button" className="card card-link" onClick={() => void makeBase(p.id)}>
                    <strong>{p.name}</strong>
                    {p.address && <div className="muted">{p.address}</div>}
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
