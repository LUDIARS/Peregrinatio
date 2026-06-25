import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import type { Place, PlaceSearchResult, TripDetail as TripDetailData } from '../types.js';
import { loadMaps, PIN_PATH } from '../lib/maps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type MapStatus = 'loading' | 'disabled' | 'ready' | 'error';

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>();
  const [data, setData] = useState<TripDetailData | null>(null);
  const [error, setError] = useState('');

  // 地図
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const infoObj = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [mapError, setMapError] = useState('');

  // 検索
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');

  // 日追加
  const [dayDate, setDayDate] = useState('');
  const [dayTitle, setDayTitle] = useState('');

  const reload = async () => {
    if (!tripId) return;
    try {
      setData(await api.getTrip(tripId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
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
          center: { lat: 35.681, lng: 139.767 }, // 東京駅
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        infoObj.current = new window.google.maps.InfoWindow();
        // 地図クリックで周辺施設検索 (Nearby)。
        mapObj.current.addListener('click', (ev: any) => {
          const lat = ev.latLng.lat();
          const lng = ev.latLng.lng();
          void runSearch({ lat, lng });
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

  // places が変わったらピンを描き直す
  useEffect(() => {
    if (mapStatus !== 'ready' || !mapObj.current || !data) return;
    const g = window.google;
    for (const m of markers.current) m.setMap(null);
    markers.current = [];
    const pinned = data.places.filter((p) => p.lat != null && p.lng != null);
    const bounds = new g.maps.LatLngBounds();
    for (const p of pinned) {
      const pos = { lat: p.lat as number, lng: p.lng as number };
      const marker = new g.maps.Marker({
        position: pos,
        map: mapObj.current,
        title: p.name,
        icon: {
          path: PIN_PATH,
          fillColor: '#0e7c86',
          fillOpacity: 0.95,
          strokeColor: '#fff',
          strokeWeight: 1.5,
          scale: 1,
          anchor: new g.maps.Point(0, 0),
        },
      });
      marker.addListener('click', () => {
        infoObj.current.setContent(
          `<div style="font-size:13px;max-width:200px"><strong>${p.name}</strong>` +
          (p.address ? `<br>${p.address}` : '') + '</div>',
        );
        infoObj.current.open(mapObj.current, marker);
      });
      markers.current.push(marker);
      bounds.extend(pos);
    }
    if (pinned.length > 0) {
      mapObj.current.fitBounds(bounds);
      if (pinned.length === 1) mapObj.current.setZoom(14);
    }
  }, [data, mapStatus]);

  const runSearch = async (loc?: { lat: number; lng: number }) => {
    if (!tripId) return;
    setSearching(true);
    setSearchMsg('');
    try {
      const center = loc ?? (mapObj.current
        ? { lat: mapObj.current.getCenter().lat(), lng: mapObj.current.getCenter().lng() }
        : undefined);
      const r = await api.searchPlaces({
        q: q.trim() || undefined,
        lat: center?.lat,
        lng: center?.lng,
      });
      setResults(r);
      if (r.length === 0) setSearchMsg('該当する施設が見つかりませんでした');
    } catch (e) {
      setSearchMsg(e instanceof Error ? e.message : '検索に失敗しました');
    } finally {
      setSearching(false);
    }
  };

  const addCandidate = async (c: PlaceSearchResult) => {
    if (!tripId) return;
    try {
      await api.createPlace(tripId, {
        name: c.name,
        address: c.address ?? undefined,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
        category: c.category ?? undefined,
      });
      setResults((prev) => prev.filter((x) => x.place_id !== c.place_id));
      await reload();
    } catch (e) {
      setSearchMsg(e instanceof Error ? e.message : '追加に失敗しました');
    }
  };

  const addDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripId) return;
    try {
      await api.createDay(tripId, { date: dayDate || undefined, title: dayTitle.trim() || undefined });
      setDayDate(''); setDayTitle('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '日の追加に失敗しました');
    }
  };

  if (!tripId) return null;
  if (error && !data) return <div className="card error">⚠ {error}</div>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const { trip, days, places } = data;

  return (
    <div>
      <div className="crumb"><Link to="/">← 旅一覧</Link></div>
      <div className="spread">
        <h2 style={{ margin: 0 }}>{trip.title}</h2>
        <a href={pdfUrl(trip.id)} target="_blank" rel="noreferrer">
          <button type="button" className="sm">📄 PDF しおり出力</button>
        </a>
      </div>
      <p className="muted">{trip.start_date ?? '日付未定'}{trip.end_date ? ` 〜 ${trip.end_date}` : ''}</p>

      {/* 地図 */}
      <h3>地図</h3>
      {mapStatus === 'disabled' && (
        <div className="card">
          地図の API キーが未設定です。<code>GET /api/map-config</code> が enabled=false を返しています。
          （地図以外の機能は利用できます）
        </div>
      )}
      {mapStatus === 'error' && <div className="card error">⚠ {mapError}</div>}
      <div
        ref={mapRef}
        className="map-canvas"
        style={{ display: mapStatus === 'disabled' ? 'none' : 'block' }}
      />
      {mapStatus === 'ready' && (
        <p className="muted" style={{ marginTop: 6 }}>地図をタップすると、その周辺の施設を検索します。</p>
      )}

      {/* 周辺検索 */}
      <h3>施設をさがして追加</h3>
      <div className="card foundation-form">
        <div className="row">
          <input
            type="search"
            placeholder="施設名・キーワード (例: 美術館)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={() => void runSearch()} disabled={searching}>
            {searching ? '検索中…' : '検索'}
          </button>
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

      {/* places 一覧 */}
      <h3>ピン / 場所 ({places.length})</h3>
      {places.length === 0 && <p className="muted">まだ場所がありません。検索から追加してください。</p>}
      <div className="stack">
        {places.map((p: Place) => (
          <Link key={p.id} to={`/trips/${trip.id}/places/${p.id}`} className="card card-link">
            <div className="spread">
              <strong>{p.name}</strong>
              {p.lat != null && p.lng != null
                ? <span className="chip">📍 ピン済</span>
                : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
            </div>
            {p.category && <span className="muted">{p.category}</span>}
            {p.address && <div className="muted">{p.address}</div>}
            {p.summary && <div className="muted" style={{ marginTop: 4 }}>{p.summary.slice(0, 80)}{p.summary.length > 80 ? '…' : ''}</div>}
          </Link>
        ))}
      </div>

      {/* days 一覧 */}
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
          <input type="text" placeholder="タイトル (任意)" value={dayTitle}
            onChange={(e) => setDayTitle(e.target.value)} style={{ flex: 1 }} />
        </div>
        <button type="submit">日を追加</button>
      </form>
    </div>
  );
}
