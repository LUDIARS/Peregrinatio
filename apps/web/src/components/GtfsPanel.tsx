import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { GtfsDeparture, GtfsFeed, GtfsStopHit } from '../types.js';

/**
 * GTFS 時刻表パネル (バス/一部鉄道の一括取込)。
 * - GTFS zip の URL を取り込む / 取込済みフィードの一覧・削除。
 * - 拠点や現在地の近くの停留所を探し、発車時刻ボードを表示する。
 * フィードは全旅で共有。中心座標は旅の拠点 (無ければ最初の座標付き場所) を使う。
 */
export function GtfsPanel({ tripId }: { tripId: string }) {
  const [feeds, setFeeds] = useState<GtfsFeed[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [stops, setStops] = useState<GtfsStopHit[]>([]);
  const [stopsBusy, setStopsBusy] = useState(false);
  const [selected, setSelected] = useState<GtfsStopHit | null>(null);
  const [departures, setDepartures] = useState<GtfsDeparture[]>([]);
  const [depBusy, setDepBusy] = useState(false);

  const loadFeeds = async () => { setFeeds(await api.gtfsFeeds()); };

  useEffect(() => {
    (async () => {
      try { await loadFeeds(); } catch (e) { setError(e instanceof Error ? e.message : 'フィード一覧の取得に失敗しました'); }
      // 中心座標: 拠点 → 最初の座標付き場所。
      try {
        const detail = await api.getTrip(tripId);
        const base = detail.places.find((p) => p.is_base === 1 && p.lat != null && p.lng != null)
          ?? detail.places.find((p) => p.lat != null && p.lng != null);
        if (base && base.lat != null && base.lng != null) setCenter({ lat: base.lat, lng: base.lng });
      } catch { /* 中心未取得は現在地ボタンで補える */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const doImport = async () => {
    if (!/^https?:\/\/\S+$/i.test(url.trim())) { setError('GTFS zip の URL を入力してください'); return; }
    setImportBusy(true); setMsg(''); setError('');
    try {
      const feed = await api.gtfsImport({ url: url.trim(), name: name.trim() || undefined });
      setMsg(`「${feed.name}」を取り込みました（停留所 ${feed.stop_count} / 便 ${feed.trip_count}）。`);
      setUrl(''); setName('');
      await loadFeeds();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取込に失敗しました');
    } finally { setImportBusy(false); }
  };

  const removeFeed = async (id: string) => {
    if (!window.confirm('このフィードを削除しますか？（取り込んだ停留所・時刻も消えます）')) return;
    try { await api.gtfsDeleteFeed(id); await loadFeeds(); setStops([]); setSelected(null); setDepartures([]); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  const findStops = async (at: { lat: number; lng: number }) => {
    setStopsBusy(true); setError(''); setSelected(null); setDepartures([]);
    try {
      const hits = await api.gtfsNearbyStops({ lat: at.lat, lng: at.lng, radius: 800, limit: 10 });
      setStops(hits);
      if (hits.length === 0) setMsg('近くに取り込み済みの停留所がありません（先に GTFS を取り込んでください）。');
    } catch (e) { setError(e instanceof Error ? e.message : '停留所の検索に失敗しました'); }
    finally { setStopsBusy(false); }
  };

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) { setError('この端末では現在地を取得できません'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const at = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setCenter(at); void findStops(at); },
      () => setError('現在地を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const openStop = async (s: GtfsStopHit) => {
    setSelected(s); setDepBusy(true); setDepartures([]);
    try { setDepartures(await api.gtfsDepartures(s.feed_id, s.stop_id, { limit: 12 })); }
    catch (e) { setError(e instanceof Error ? e.message : '時刻の取得に失敗しました'); }
    finally { setDepBusy(false); }
  };

  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');
  const modeIcon = (rt: number | null) => (rt == null ? '🚏' : rt === 3 ? '🚌' : '🚆');

  return (
    <section className="card foundation-form">
      <h3 style={{ marginTop: 0 }}>🚌 GTFS 時刻表（バス／一部鉄道）</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        GTFS / GTFS-JP の zip を取り込み、近くの停留所の発車時刻を表示します。
        データは <a href="https://gtfs-data.jp/" target="_blank" rel="noreferrer">gtfs-data.jp</a> など事業者の公開 URL から。
      </p>
      {error && <div className="error">⚠ {error}</div>}
      {msg && <p className="muted">{msg}</p>}

      {/* 取込 */}
      <label htmlFor="gtfs-url">GTFS zip の URL</label>
      <input id="gtfs-url" type="url" placeholder="https://.../gtfs.zip" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input type="text" placeholder="表示名（任意・空なら事業者名）" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => void doImport()} disabled={importBusy || !url.trim()}>
        {importBusy ? '取り込み中…（大きいと時間がかかります）' : '取り込む'}
      </button>

      {/* フィード一覧 */}
      {feeds.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
          {feeds.map((f) => (
            <div key={f.id} className="spread" style={{ alignItems: 'center' }}>
              <span><strong>{f.name}</strong> <span className="muted">停留所 {f.stop_count} / 便 {f.trip_count}</span></span>
              <button type="button" className="sm ghost" onClick={() => void removeFeed(f.id)}>削除</button>
            </div>
          ))}
        </div>
      )}

      {/* 近くの停留所 */}
      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="sm" onClick={() => center && void findStops(center)} disabled={!center || stopsBusy}>
          {stopsBusy ? '検索中…' : '🏨 拠点の近くの停留所'}
        </button>
        <button type="button" className="sm ghost" onClick={useCurrentLocation}>📍 現在地で探す</button>
      </div>

      {stops.length > 0 && (
        <div className="stack" style={{ marginTop: 8 }}>
          {stops.map((s) => (
            <button key={`${s.feed_id}:${s.stop_id}`} type="button"
              className={`card card-link${selected?.stop_id === s.stop_id && selected?.feed_id === s.feed_id ? ' active' : ''}`}
              onClick={() => void openStop(s)}>
              <strong>{s.stop_name ?? s.stop_id}</strong>
              <div className="muted">{s.feed_name} ・ {s.distance_m}m</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginTop: 8 }}>
          <strong>{selected.stop_name ?? selected.stop_id} の発車（{depBusy ? '取得中…' : '直近'}）</strong>
          {!depBusy && departures.length === 0 && <p className="muted" style={{ margin: '6px 0 0' }}>直近の発車はありません（運行日/時間帯外の可能性）。</p>}
          <div className="stack" style={{ marginTop: 6 }}>
            {departures.map((d, i) => (
              <div key={i} className="spread">
                <strong>{hhmm(d.departure_time)}</strong>
                <span className="muted">{modeIcon(d.route_type)} {[d.route_name, d.headsign].filter(Boolean).join(' ／ ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
