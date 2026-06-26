import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import type { Place, PlaceSearchResult, TripDetail as TripDetailData } from '../types.js';
import { loadMaps, PIN_PATH } from '../lib/maps.js';
import { PlaceDetailPane } from './PlaceDetail.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type MapStatus = 'loading' | 'disabled' | 'ready' | 'error';

// 周囲 ~10-30km を見せたいので低めのズームに。z11≈横20km / z10≈横40km。
const BASE_ZOOM = 11; // 拠点クリック/フォーカス時
const AREA_ZOOM = 11; // 初期 (拠点中心の周辺)

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>();
  const [data, setData] = useState<TripDetailData | null>(null);
  const [error, setError] = useState('');

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const infoObj = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const didCenter = useRef(false);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [mapError, setMapError] = useState('');
  const [activeBaseId, setActiveBaseId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');

  const [dayDate, setDayDate] = useState('');
  const [dayTitle, setDayTitle] = useState('');

  const reload = async () => {
    if (!tripId) return;
    try { setData(await api.getTrip(tripId)); }
    catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [tripId]);

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
        mapObj.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: 35.681, lng: 139.767 }, zoom: 11,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        });
        infoObj.current = new window.google.maps.InfoWindow();
        mapObj.current.addListener('click', (ev: any) => {
          void runSearch({ lat: ev.latLng.lat(), lng: ev.latLng.lng() });
        });
        setMapStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : '地図の初期化に失敗しました');
          setMapStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 詳細ペーンの開閉で地図サイズが変わるので resize を通知。
  useEffect(() => {
    if (mapStatus === 'ready' && mapObj.current && window.google) {
      const t = setTimeout(() => window.google.maps.event.trigger(mapObj.current, 'resize'), 260);
      return () => clearTimeout(t);
    }
  }, [selectedId, mapStatus]);

  const focusBase = (p: Place) => {
    if (!mapObj.current || p.lat == null || p.lng == null) return;
    setActiveBaseId(p.id);
    mapObj.current.panTo({ lat: p.lat, lng: p.lng });
    mapObj.current.setZoom(BASE_ZOOM);
  };

  const fitAll = () => {
    if (!mapObj.current || !data) return;
    const g = window.google;
    const pinned = data.places.filter((p) => p.lat != null && p.lng != null);
    if (pinned.length === 0) return;
    const b = new g.maps.LatLngBounds();
    for (const p of pinned) b.extend({ lat: p.lat as number, lng: p.lng as number });
    mapObj.current.fitBounds(b);
    setActiveBaseId(null);
  };

  /** 場所を選択 = 詳細を開く + 地図を寄せる。モバイルはドロワーを閉じる。 */
  const selectPlace = (p: Place) => {
    setSelectedId(p.id);
    setDrawerOpen(false);
    // 場所選択は中心を寄せるだけ (周辺が見える広域ズームは維持。寄り過ぎ防止)。
    if (mapObj.current && p.lat != null && p.lng != null) {
      mapObj.current.panTo({ lat: p.lat, lng: p.lng });
      if (mapObj.current.getZoom() < 10) mapObj.current.setZoom(BASE_ZOOM);
    }
  };

  // ピン描画
  useEffect(() => {
    if (mapStatus !== 'ready' || !mapObj.current || !data) return;
    const g = window.google;
    for (const m of markers.current) m.setMap(null);
    markers.current = [];
    const pinned = data.places.filter((p) => p.lat != null && p.lng != null);
    const bases = pinned.filter((p) => p.is_base === 1);

    for (const p of pinned) {
      const isBase = p.is_base === 1;
      const pos = { lat: p.lat as number, lng: p.lng as number };
      const marker = new g.maps.Marker({
        position: pos, map: mapObj.current, title: p.name,
        zIndex: isBase ? 1000 : 1,
        label: isBase ? { text: '🏨', fontSize: '14px' } : undefined,
        icon: {
          path: PIN_PATH,
          fillColor: isBase ? '#e8590c' : '#0e7c86',
          fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: isBase ? 2 : 1.5,
          scale: isBase ? 1.7 : 1,
          labelOrigin: new g.maps.Point(0, -26),
          anchor: new g.maps.Point(0, 0),
        },
      });
      marker.addListener('click', () => {
        if (isBase) { focusBase(p); }
        else { selectPlace(p); }
      });
      markers.current.push(marker);
    }

    if (!didCenter.current && pinned.length > 0) {
      didCenter.current = true;
      if (bases.length > 0) {
        const b0 = bases[0]!;
        setActiveBaseId(b0.id);
        mapObj.current.panTo({ lat: b0.lat as number, lng: b0.lng as number });
        mapObj.current.setZoom(AREA_ZOOM);
      } else { fitAll(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mapStatus]);

  const runSearch = async (loc?: { lat: number; lng: number }) => {
    if (!tripId) return;
    setSearching(true); setSearchMsg('');
    try {
      const center = loc ?? (mapObj.current
        ? { lat: mapObj.current.getCenter().lat(), lng: mapObj.current.getCenter().lng() } : undefined);
      const r = await api.searchPlaces({ q: q.trim() || undefined, lat: center?.lat, lng: center?.lng });
      setResults(r);
      if (r.length === 0) setSearchMsg('該当する施設が見つかりませんでした');
    } catch (e) { setSearchMsg(e instanceof Error ? e.message : '検索に失敗しました'); }
    finally { setSearching(false); }
  };

  const addCandidate = async (c: PlaceSearchResult) => {
    if (!tripId) return;
    try {
      await api.createPlace(tripId, {
        name: c.name, address: c.address ?? undefined,
        lat: c.lat ?? undefined, lng: c.lng ?? undefined, category: c.category ?? undefined,
      });
      setResults((prev) => prev.filter((x) => x.place_id !== c.place_id));
      await reload();
    } catch (e) { setSearchMsg(e instanceof Error ? e.message : '追加に失敗しました'); }
  };

  const toggleBase = async (p: Place) => {
    try { await api.patchPlace(p.id, { is_base: p.is_base === 1 ? 0 : 1 }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '拠点の更新に失敗しました'); }
  };

  const addDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripId) return;
    try {
      await api.createDay(tripId, { date: dayDate || undefined, title: dayTitle.trim() || undefined });
      setDayDate(''); setDayTitle(''); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : '日の追加に失敗しました'); }
  };

  if (!tripId) return null;
  if (error && !data) return <div className="card error">⚠ {error}</div>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const { trip, days, places } = data;
  const bases = places.filter((p) => p.is_base === 1 && p.lat != null && p.lng != null);

  return (
    <div className={`trip-ws${selectedId ? ' has-detail' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      {/* モバイル用トップバー (☰ で一覧をスライドイン) */}
      <div className="ws-topbar">
        <button type="button" className="drawer-toggle" onClick={() => setDrawerOpen((o) => !o)} aria-label="場所一覧">☰ 一覧</button>
        <span className="ws-trip-title">{trip.title}</span>
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
        {places.length === 0 && <p className="muted">まだ場所がありません。地図右の検索から追加してください。</p>}
        <div className="stack">
          {places.map((p: Place) => (
            <div key={p.id}
              className={`place-row${p.is_base === 1 ? ' is-base' : ''}${selectedId === p.id ? ' selected' : ''}`}>
              <button type="button" className="place-row-main" onClick={() => selectPlace(p)}>
                <div className="spread">
                  <strong>{p.is_base === 1 ? '🏨 ' : ''}{p.name}</strong>
                  {p.lat != null && p.lng != null
                    ? <span className="chip">📍</span>
                    : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
                </div>
                {p.category && <span className="muted">{p.category}</span>}
              </button>
              <div className="place-row-actions">
                {p.lat != null && p.lng != null && (
                  <button type="button" className="sm ghost"
                    onClick={() => (p.is_base === 1 ? focusBase(p) : toggleBase(p))}>
                    {p.is_base === 1 ? '地図で見る' : '拠点にする'}
                  </button>
                )}
                {p.is_base === 1 && <button type="button" className="sm ghost" onClick={() => void toggleBase(p)}>拠点解除</button>}
              </div>
            </div>
          ))}
        </div>

        <h3>日程 ({days.length} 日)</h3>
        <div className="stack">
          {days.map((d) => (
            <Link key={d.id} to={`/trips/${trip.id}/days/${d.id}`} className="card card-link">
              <strong>{d.title || `${d.day_index + 1} 日目`}</strong>
              <div className="muted">{d.date ?? '日付未定'}</div>
            </Link>
          ))}
        </div>
        <form className="card foundation-form" onSubmit={addDay}>
          <h3 style={{ marginTop: 0 }}>日を追加</h3>
          <div className="row">
            <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} style={{ flex: 1 }} />
            <input type="text" placeholder="タイトル (任意)" value={dayTitle} onChange={(e) => setDayTitle(e.target.value)} style={{ flex: 1 }} />
          </div>
          <button type="submit">日を追加</button>
        </form>
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
        <div ref={mapRef} className="map-canvas" style={{ display: mapStatus === 'disabled' ? 'none' : 'block' }} />

        <div className="card foundation-form" style={{ marginTop: 10 }}>
          <div className="row">
            <input type="search" placeholder="施設名・キーワード (例: 美術館)" value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} style={{ flex: 1 }} />
            <button type="button" onClick={() => void runSearch()} disabled={searching}>{searching ? '検索中…' : '検索'}</button>
          </div>
          {searchMsg && <div className="muted">{searchMsg}</div>}
          <div className="stack">
            {results.map((c) => (
              <div key={c.place_id} className="spread" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
                <div>
                  <strong>{c.name}</strong>
                  {c.category && <span className="chip" style={{ marginLeft: 6 }}>{c.category}</span>}
                  {c.address && <div className="muted">{c.address}</div>}
                </div>
                <button type="button" className="sm ghost" onClick={() => void addCandidate(c)}>追加</button>
              </div>
            ))}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>地図タップで周辺検索。ピンタップで詳細（🏨拠点はズーム）。</p>
      </section>

      {/* 右: 場所詳細 (PC=カラム / モバイル=ポップアップ) */}
      {selectedId && (
        <aside className="ws-detail">
          <PlaceDetailPane tripId={tripId} placeId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
        </aside>
      )}

      {/* モバイル: ドロワー背景 */}
      <div className="ws-backdrop" onClick={() => setDrawerOpen(false)} />
    </div>
  );
}
