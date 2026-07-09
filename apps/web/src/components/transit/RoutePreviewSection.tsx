import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { transitRouteStyle } from '../../lib/maps.js';
import type { RouteMode, RouteSearchOption, TripDetail, TripPlace } from '../../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type TimeBasis = 'departure' | 'arrival';

interface RoutePoint {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  kind: 'origin' | 'place';
}

const MODE_OPTS: { value: RouteMode; label: string }[] = [
  { value: 'transit', label: '公共交通' },
];

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function placeToPoint(p: TripPlace): RoutePoint | null {
  if (p.lat == null || p.lng == null) return null;
  return { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, kind: 'place' };
}

export function RoutePreviewSection({ tripId, map }: { tripId: string; map?: any }) {
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [mode, setMode] = useState<RouteMode>('transit');
  const [basis, setBasis] = useState<TimeBasis>('departure');
  const [date, setDate] = useState(todayYmd);
  const [time, setTime] = useState(currentHm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<RouteSearchOption[]>([]);
  const overlaysRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getTrip(tripId);
        if (cancelled) return;
        setDetail(d);
        const defaultDate = d.trip.start_date ?? d.days.find((day) => day.date)?.date ?? todayYmd();
        setDate(defaultDate);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '場所の読み込みに失敗しました');
      }
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => () => {
    clearOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const points = useMemo(() => {
    if (!detail) return [];
    const out: RoutePoint[] = [];
    if (detail.trip.origin_kind !== 'none' && detail.trip.origin_lat != null && detail.trip.origin_lng != null) {
      out.push({
        id: '@origin',
        name: detail.trip.origin_label || '出発地点',
        address: detail.trip.origin_address,
        lat: detail.trip.origin_lat,
        lng: detail.trip.origin_lng,
        kind: 'origin',
      });
    }
    for (const p of detail.places) {
      if (p.postponed === 1) continue;
      const point = placeToPoint(p);
      if (point) out.push(point);
    }
    return out;
  }, [detail]);

  useEffect(() => {
    if (points.length >= 2) {
      setFromId((cur) => (cur && points.some((p) => p.id === cur) ? cur : points[0]!.id));
      setToId((cur) => (cur && points.some((p) => p.id === cur) ? cur : points[1]!.id));
    }
  }, [points]);

  const clearOverlays = () => {
    for (const o of overlaysRef.current) o.setMap(null);
    overlaysRef.current = [];
  };

  const clearRoute = () => {
    clearOverlays();
    setResults([]);
  };

  const drawOption = (option: RouteSearchOption) => {
    if (!map || !window.google?.maps) return;
    clearOverlays();
    const g = window.google;
    const bounds = new g.LatLngBounds();

    option.legs.forEach((leg, i) => {
      const a = leg.origin_lat != null && leg.origin_lng != null ? { lat: leg.origin_lat, lng: leg.origin_lng } : null;
      const b = leg.dest_lat != null && leg.dest_lng != null ? { lat: leg.dest_lat, lng: leg.dest_lng } : null;
      if (a) {
        bounds.extend(a);
        overlaysRef.current.push(new g.Marker({
          map, position: a, title: leg.origin_stop_name ?? leg.origin_stop_id,
          label: { text: i === 0 ? '発' : '乗', color: '#fff', fontSize: '11px' },
        }));
      }
      if (b) {
        bounds.extend(b);
        overlaysRef.current.push(new g.Marker({
          map, position: b, title: leg.dest_stop_name ?? leg.dest_stop_id,
          label: { text: i === option.legs.length - 1 ? '着' : '換', color: '#fff', fontSize: '11px' },
        }));
      }
      if (a && b) {
        const style = transitRouteStyle({
          routeType: leg.route_type,
          routeName: leg.route_name,
          headsign: leg.headsign,
          feedName: leg.feed_name,
        });
        overlaysRef.current.push(new g.Polyline({
          map, path: [a, b], strokeColor: style.strokeColor, strokeOpacity: 0.9, strokeWeight: 5, zIndex: 80 + i,
        }));
      }
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
    }
  };

  const showRoute = async () => {
    const from = points.find((p) => p.id === fromId);
    const to = points.find((p) => p.id === toId);
    if (!from || !to) { setError('出発地と到着地を選んでください'); return; }
    if (from.id === to.id) { setError('出発地と到着地は別の場所を選んでください'); return; }
    if (!date || !time) { setError('日付と時刻を入力してください'); return; }
    if (mode !== 'transit') { setError('取り込み済み路線の検索は公共交通のみ対応しています'); return; }

    setBusy(true); setError(''); setResults([]);
    try {
      const res = await api.routeSearch({
        from: { lat: from.lat, lng: from.lng },
        to: { lat: to.lat, lng: to.lng },
        date,
        time,
        basis,
      });
      setResults(res.options);
      if (res.options.length === 0) {
        setError(res.from_stop_count === 0 || res.to_stop_count === 0
          ? '近くに取り込み済みの停留所がありません。先に路線情報を取り込んでください。'
          : '条件に合う経路が見つかりませんでした。日付・時刻・ダイヤを変えてください。');
        return;
      }
      drawOption(res.options[0]!);
    } catch (e) {
      setError(e instanceof Error ? e.message : '経路の表示に失敗しました');
    } finally { setBusy(false); }
  };

  return (
    <section className="card transit-route-finder">
      <div className="spread">
        <strong>路線検索</strong>
        {results.length > 0 && <button type="button" className="sm ghost" onClick={clearRoute}>消す</button>}
      </div>
      <div className="foundation-form">
        <label>
          出発地
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {points.map((p) => <option key={p.id} value={p.id}>{p.kind === 'origin' ? '🏁 ' : ''}{p.name}</option>)}
          </select>
        </label>
        <label>
          到着地
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {points.map((p) => <option key={p.id} value={p.id}>{p.kind === 'origin' ? '🏁 ' : ''}{p.name}</option>)}
          </select>
        </label>
        <div className="transit-route-grid">
          <label>
            日付
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {detail?.days.filter((d) => d.date).map((d) => (
                <option key={d.id} value={d.date!}>{d.title || `${d.day_index + 1}日目`} {d.date}</option>
              ))}
              {!detail?.days.some((d) => d.date === date) && <option value={date}>{date}</option>}
            </select>
          </label>
          <label>
            時刻
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="transit-route-grid">
          <label>
            基準
            <select value={basis} onChange={(e) => setBasis(e.target.value as TimeBasis)} disabled={mode !== 'transit'}>
              <option value="departure">出発時刻</option>
              <option value="arrival">到着時刻</option>
            </select>
          </label>
          <label>
            手段
            <select value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
              {MODE_OPTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => void showRoute()} disabled={busy || points.length < 2}>
          {busy ? '検索中…' : '検索する'}
        </button>
      </div>
      {!map && <p className="muted">地図が読み込み前でも検索できます。地図がある場合は停留所と区間線を表示します。</p>}
      {points.length < 2 && <p className="muted">座標のある場所が2つ以上必要です。</p>}
      {results.length > 0 && (
        <div className="stack route-search-results">
          {results.map((r, i) => (
            <button key={`${r.departure_time}-${r.arrival_time}-${i}`} type="button" className="route-search-option"
              onClick={() => drawOption(r)}>
              <span>
                <strong>{r.departure_time} → {r.arrival_time}</strong>
                <span className="muted">{r.duration_min}分 / 乗換 {r.transfer_count}回 / 徒歩目安 {r.walk_from_m + r.walk_to_m}m</span>
              </span>
              <small className="muted">{r.summary}</small>
            </button>
          ))}
        </div>
      )}
      {error && <div className="error">⚠ {error}</div>}
    </section>
  );
}
