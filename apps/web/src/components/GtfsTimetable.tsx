import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { loadMaps, PIN_PATH } from '../lib/maps.js';
import type { GtfsTimetablePattern } from '../types.js';

/** ローカル今日を input[type=date] 用 'YYYY-MM-DD' で返す。 */
function todayInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 路線の時刻表を「停留所=横軸 / 便=縦軸(時刻順)」の表で描画し、停留所の位置を地図に出す。
 * 停車順序が違う便はパターンとして分け、タブで切り替える。
 */
export function GtfsTimetable({ feedId, routeId, routeLabel }: { feedId: string; routeId: string; routeLabel: string }) {
  const [patterns, setPatterns] = useState<GtfsTimetablePattern[]>([]);
  const [date, setDate] = useState<string>(todayInput()); // 'YYYY-MM-DD'
  const [pIdx, setPIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const mapHost = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const overlays = useRef<any[]>([]);

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

  // 地図に現在パターンの停留所を順番に描く (番号付きマーカー + 経路線)。
  useEffect(() => {
    const pat = patterns[pIdx];
    if (!pat || !mapHost.current) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.mapConfig();
        if (cancelled || !cfg.enabled || !cfg.apiKey || !mapHost.current) return;
        await loadMaps(cfg.apiKey);
        if (cancelled || !mapHost.current) return;
        const g = window.google;
        if (!mapObj.current) {
          mapObj.current = new g.maps.Map(mapHost.current, {
            center: { lat: 36.96, lng: 140.04 }, zoom: 12,
            mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
          });
        }
        for (const o of overlays.current) o.setMap(null);
        overlays.current = [];
        const pts = pat.stops.filter((s) => s.lat != null && s.lng != null);
        const path: any[] = [];
        const bounds = new g.maps.LatLngBounds();
        pts.forEach((s, i) => {
          const pos = { lat: s.lat as number, lng: s.lng as number };
          path.push(pos); bounds.extend(pos);
          const marker = new g.maps.Marker({
            position: pos, map: mapObj.current, title: `${i + 1}. ${s.stop_name ?? ''}`,
            label: { text: String(i + 1), fontSize: '10px', color: '#fff' },
            icon: { path: PIN_PATH, fillColor: '#0e7c86', fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 1.2,
              scale: 1, labelOrigin: new g.maps.Point(0, -26), anchor: new g.maps.Point(0, 0) },
          });
          overlays.current.push(marker);
        });
        if (path.length > 1) {
          const line = new g.maps.Polyline({ path, map: mapObj.current, strokeColor: '#0e7c86', strokeOpacity: 0.7, strokeWeight: 3 });
          overlays.current.push(line);
        }
        if (!bounds.isEmpty()) mapObj.current.fitBounds(bounds);
      } catch { /* 地図は best-effort (表は出す) */ }
    })();
    return () => { cancelled = true; };
  }, [patterns, pIdx]);

  const idx = Math.min(pIdx, Math.max(0, patterns.length - 1));
  const pat = patterns[idx] ?? null;
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

  return (
    <div className="gtfs-tt">
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <strong>🕒 {routeLabel}</strong>
        {pat && <span className="muted" style={{ fontSize: 12 }}>{pat.trips.length} 便 / {pat.stops.length} 停留所</span>}
      </div>

      {/* 運行日で絞る (平日/土日祝/特別ダイヤを混ぜない)。既定は今日。 */}
      <div className="foundation-form" style={{ margin: '6px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          📅 運行日
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayInput())} style={{ width: 150 }} />
          <button type="button" className="sm ghost" onClick={() => setDate(todayInput())}>今日</button>
        </label>
        <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>その日に運行する便だけを表示します。</p>
      </div>

      {loading && <p className="muted">時刻表を読み込み中…</p>}
      {err && <div className="error">⚠ {err}</div>}
      {!loading && !err && patterns.length === 0 && (
        <p className="muted">この日に運行する便はありません（日付を変えてみてください）。</p>
      )}

      {!loading && !err && pat && (
        <>
          {/* 停車パターンが複数あれば切替 (方向・経路違い)。 */}
          {patterns.length > 1 && (
            <div className="base-bar" style={{ marginTop: 6 }}>
              {patterns.map((p, i) => (
                <button key={i} type="button" className={i === idx ? 'chip-btn active' : 'chip-btn'} onClick={() => setPIdx(i)}>
                  {p.headsign || `パターン${i + 1}`}（{p.trips.length}便）
                </button>
              ))}
            </div>
          )}

          {/* 地図: 停留所の位置と順序。 */}
          <div ref={mapHost} className="gtfs-tt-map" />

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
