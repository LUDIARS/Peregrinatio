import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { loadMaps, PIN_PATH, transitRouteStyle } from '../lib/maps.js';
import type { GtfsTimetablePattern, GtfsTimetableStop } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 路線の時刻表を「停留所=横軸 / 便=縦軸(時刻順)」の表で描画し、停留所の位置を地図に出す。
 * 停車順序が違う便はパターンとして分け、タブで切り替える。
 * `map` (外部の Google 地図) を渡すとそこへ停留所・順路を描画する (メイン地図を見ながらの確認用)。
 * 渡さなければ従来どおり専用のミニ地図を持つ。
 */
export function GtfsTimetable(
  { feedId, routeId, routeLabel, routeType, date, map: externalMap, compact = false, mapOnly = false, showMap = true }:
  {
    feedId: string;
    routeId: string;
    routeLabel: string;
    routeType?: number | null;
    date: string;
    map?: any;
    compact?: boolean;
    mapOnly?: boolean;
    showMap?: boolean;
  },
) {
  const [patterns, setPatterns] = useState<GtfsTimetablePattern[]>([]);
  const [allStops, setAllStops] = useState<GtfsTimetableStop[]>([]);
  const [pIdx, setPIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const mapHost = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const routeStyle = transitRouteStyle({ routeType, routeLabel });

  // フィードの全停留所 (1 マップに全部出す用)。フィードが変わった時だけ取り直す。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const s = await api.gtfsFeedStops(feedId); if (!cancelled) setAllStops(s); }
      catch { if (!cancelled) setAllStops([]); }
    })();
    return () => { cancelled = true; };
  }, [feedId]);

  useEffect(() => {
    setLoading(true); setErr(''); setPIdx(0);
    (async () => {
      try {
        const res = await api.gtfsRouteTimetable(feedId, routeId, date.replace(/-/g, ''));
        setPatterns(res.patterns);
      }
      catch (e) { setErr(e instanceof Error ? e.message : '時刻表の取得に失敗しました'); }
      finally { setLoading(false); }
    })();
  }, [feedId, routeId, date]);

  // 1 マップに「フィードの全停留所」(小さい点) + 現在路線の停留所(番号+順路線) を描く。
  // 外部地図 (メイン地図) があればそこへ、無ければ専用ミニ地図を生成して描く。
  useEffect(() => {
    const pat = patterns[pIdx];
    let cancelled = false;
    (async () => {
      try {
        let target: any = externalMap ?? null;
        if (!target) {
          if (!showMap) return;
          if (!mapHost.current) return;
          const cfg = await api.mapConfig();
          if (cancelled || !cfg.enabled || !cfg.apiKey || !mapHost.current) return;
          await loadMaps(cfg.apiKey);
          if (cancelled || !mapHost.current) return;
          if (!mapObj.current) {
            mapObj.current = new window.google.maps.Map(mapHost.current, {
              center: { lat: 36.96, lng: 140.04 }, zoom: 11,
              gestureHandling: 'greedy',
              mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
            });
          }
          target = mapObj.current;
        }
        if (cancelled || !window.google) return;
        const g = window.google;
        for (const o of overlays.current) o.setMap(null);
        overlays.current = [];
        const bounds = new g.maps.LatLngBounds();

        // フィードの全停留所を薄い点で (1 マップに全部)。
        for (const s of allStops) {
          if (s.lat == null || s.lng == null) continue;
          const pos = { lat: s.lat, lng: s.lng };
          bounds.extend(pos);
          const dot = new g.maps.Marker({
            position: pos, map: target, title: s.stop_name ?? s.stop_id, clickable: false,
            icon: { path: g.maps.SymbolPath.CIRCLE, scale: 2.6, fillColor: '#9bbcbe', fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 0.6 },
          });
          overlays.current.push(dot);
        }

        // 現在路線の停留所を番号付き + 順路ポリラインで強調。
        // メイン地図では場所ピン (zIndex 最大 2000) より手前に出す。
        const pts = (pat?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
        const path: any[] = [];
        pts.forEach((s, i) => {
          const pos = { lat: s.lat as number, lng: s.lng as number };
          path.push(pos); bounds.extend(pos);
          const marker = new g.maps.Marker({
            position: pos, map: target, title: `${i + 1}. ${s.stop_name ?? ''}`, zIndex: 3000,
            label: { text: String(i + 1), fontSize: '10px', color: routeStyle.labelColor },
            icon: { path: PIN_PATH, fillColor: routeStyle.markerColor, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 1.2,
              scale: 1, labelOrigin: new g.maps.Point(0, -26), anchor: new g.maps.Point(0, 0) },
          });
          overlays.current.push(marker);
        });
        if (path.length > 1) {
          const line = new g.maps.Polyline({ path, map: target, strokeColor: routeStyle.strokeColor, strokeOpacity: 0.85, strokeWeight: 4, zIndex: 50 });
          overlays.current.push(line);
        }
        // 全停留所が見えるよう全体にフィット (全部載せる)。
        if (!bounds.isEmpty()) target.fitBounds(bounds);
      } catch { /* 地図は best-effort (表は出す) */ }
    })();
    return () => { cancelled = true; };
  }, [allStops, patterns, pIdx, externalMap, routeLabel, routeType]);

  // アンマウント時に描画物を消す (外部地図=メイン地図に停留所を残さないため)。
  useEffect(() => () => {
    for (const o of overlays.current) o.setMap(null);
    overlays.current = [];
  }, []);

  const idx = Math.min(pIdx, Math.max(0, patterns.length - 1));
  const pat = patterns[idx] ?? null;
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');
  const firstStop = pat?.stops[0] ?? null;
  const lastStop = pat && pat.stops.length > 0 ? pat.stops[pat.stops.length - 1]! : null;

  if (mapOnly) return null;

  return (
    <div className={`gtfs-tt${compact ? ' compact' : ''}`}>
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <strong>🕒 {routeLabel}</strong>
        {pat && <span className="muted" style={{ fontSize: 12 }}>{date.replace(/-/g, '/')} ・ {pat.trips.length} 便 / {pat.stops.length} 停留所</span>}
      </div>

      {/* 停車パターンが複数あれば切替 (方向・経路違い)。 */}
      {!loading && !err && patterns.length > 1 && (
        <div className="base-bar" style={{ marginTop: 6 }}>
          {patterns.map((p, i) => (
            <button key={i} type="button" className={i === idx ? 'chip-btn active' : 'chip-btn'} onClick={() => setPIdx(i)}>
              {p.headsign || `パターン${i + 1}`}（{p.trips.length}便）
            </button>
          ))}
        </div>
      )}

      {pat && pat.stops.length > 0 && (
        <details className="route-stop-outline">
          <summary>
            <span><strong>始発</strong> {firstStop?.stop_name ?? firstStop?.stop_id}</span>
            <span className="muted">→ {lastStop?.stop_name ?? lastStop?.stop_id}</span>
          </summary>
          <ol>
            {pat.stops.map((s, i) => (
              <li key={`${s.stop_id}-${i}`} className={i === 0 || i === pat.stops.length - 1 ? 'terminal' : ''}>
                <span className="chip">{i === 0 ? '始発' : i === pat.stops.length - 1 ? '終点' : '中継'}</span>
                <span>{s.stop_name ?? s.stop_id}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* 地図: 外部地図 (メイン地図) 使用時は専用ミニ地図を出さない。 */}
      {showMap && !externalMap && <div ref={mapHost} className="gtfs-tt-map" />}
      {showMap && externalMap && (
        <p className="muted" style={{ fontSize: 11, margin: '6px 0' }}>
          🗺 停留所と順路はメインの地図に表示しています。
        </p>
      )}

      {loading && <p className="muted">時刻表を読み込み中…</p>}
      {err && <div className="error">⚠ {err}</div>}
      {!loading && !err && patterns.length === 0 && (
        <p className="muted">この日に運行する便はありません（運行日を変えてみてください）。地図には全停留所を表示しています。</p>
      )}

      {!loading && !err && pat && (
        <>
          {/* 時刻表: 横軸=停留所 / 縦軸=便(時刻順、上ほど早い)。横スクロール、左端の便列は固定。 */}
          <div className="gtfs-tt-scroll">
            <table className="gtfs-tt-table">
              <thead>
                <tr>
                  <th className="gtfs-tt-corner">便＼停留所</th>
                  {pat.stops.map((s, si) => (
                    <th key={`${s.stop_id}-${si}`} className="gtfs-tt-stophead" title={s.stop_name ?? s.stop_id}>
                      <span>{si + 1}. {s.stop_name ?? s.stop_id}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pat.trips.map((t, ti) => (
                  <tr key={t.trip_id}>
                    <th className="gtfs-tt-trip" scope="row" title={t.headsign ?? ''}>{ti + 1}</th>
                    {pat.stops.map((s, si) => (
                      <td key={`${s.stop_id}-${si}`}>{hhmm(t.times[si] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            横＝停留所（左から順に停車）、縦＝便（上ほど早い発）。空欄はその便が通らない停留所です。
          </p>
        </>
      )}
    </div>
  );
}
