import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { GtfsTimetable } from './GtfsTimetable.js';
import { RoutePreviewSection } from './transit/RoutePreviewSection.js';
import { transitRouteStyle } from '../lib/maps.js';
import type { GtfsFeed, RouteSummary, SelectedGtfsRoute, ServiceDayKind, TripDay } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type DayKind = ServiceDayKind;

const DAY_KIND_LABEL: Record<DayKind, string> = {
  weekday: '平日',
  weekend: '土日',
  holiday: '祝日',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromGtfsDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function nextMatchingDate(kind: DayKind): string {
  const d = new Date();
  for (let i = 0; i < 14; i++) {
    const day = d.getDay();
    if (kind === 'weekday' && day >= 1 && day <= 5) return toYmd(d);
    if (kind === 'weekend' && (day === 0 || day === 6)) return toYmd(d);
    d.setDate(d.getDate() + 1);
  }
  return toYmd(new Date());
}

function dateMatchesKind(date: string, kind: DayKind): boolean {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay();
  if (kind === 'weekday') return day >= 1 && day <= 5;
  if (kind === 'weekend') return day === 0 || day === 6;
  return false;
}

function countForKind(route: RouteSummary, kind: DayKind): number {
  if (kind === 'weekday') return route.weekday_trip_count;
  if (kind === 'weekend') return route.weekend_trip_count;
  return route.holiday_trip_count;
}

function dayKindDate(kind: DayKind, route: RouteSummary | null, tripDays: TripDay[]): string {
  if (kind === 'holiday' && route?.holiday_sample_date) return fromGtfsDate(route.holiday_sample_date);
  const tripDate = tripDays.find((d) => d.date && dateMatchesKind(d.date, kind))?.date;
  return tripDate ?? nextMatchingDate(kind === 'holiday' ? 'weekend' : kind);
}

function routeIcon(route: Pick<RouteSummary, 'route_type' | 'route_label' | 'feed_name'>): string {
  const style = transitRouteStyle({ routeType: route.route_type, routeLabel: route.route_label, feedName: route.feed_name });
  if (style.kind === 'shinkansen') return '🚄';
  if (style.kind === 'rail') return '🚆';
  if (style.kind === 'shuttle_bus') return '🚌';
  return '🚌';
}

/**
 * 路線パネル。
 * データ形式名は出さず、ユーザ操作を「路線一覧」と「経路取り込み」に集約する。
 */
export function GtfsPanel(
  { tripId, map, selectedRoute, onSelectedRouteChange }:
  { tripId: string; map?: any; selectedRoute?: SelectedGtfsRoute | null; onSelectedRouteChange?: (route: SelectedGtfsRoute | null) => void },
) {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [feeds, setFeeds] = useState<GtfsFeed[]>([]);
  const [tripDays, setTripDays] = useState<TripDay[]>([]);
  const [query, setQuery] = useState('');
  const [dayKind, setDayKind] = useState<DayKind>('weekday');
  const [selected, setSelected] = useState<RouteSummary | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [routeRows, feedRows] = await Promise.all([api.routeSummaries(), api.gtfsFeeds()]);
    setRoutes(routeRows);
    setFeeds(feedRows);
    setSelected((cur) => {
      const parentSelected = selectedRoute
        ? routeRows.find((r) => r.feed_id === selectedRoute.feed_id && r.route_id === selectedRoute.route_id)
        : null;
      const next = parentSelected ?? (cur ? routeRows.find((r) => r.feed_id === cur.feed_id && r.route_id === cur.route_id) : null);
      return next ?? routeRows[0] ?? null;
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
        const detail = await api.getTrip(tripId);
        setTripDays([...detail.days].sort((a, b) => a.day_index - b.day_index));
      } catch (e) {
        setError(e instanceof Error ? e.message : '路線一覧の取得に失敗しました');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    if (!selectedRoute || routes.length === 0) return;
    const next = routes.find((r) => r.feed_id === selectedRoute.feed_id && r.route_id === selectedRoute.route_id);
    if (next) setSelected(next);
  }, [selectedRoute, routes]);

  const selectedDate = useMemo(() => dayKindDate(dayKind, selected, tripDays), [dayKind, selected, tripDays]);
  useEffect(() => {
    if (!selected) {
      onSelectedRouteChange?.(null);
      return;
    }
    onSelectedRouteChange?.({
      feed_id: selected.feed_id,
      route_id: selected.route_id,
      route_label: selected.route_label,
      route_type: selected.route_type,
      date: selectedDate,
    });
  }, [selected, selectedDate, onSelectedRouteChange]);

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter((r) => [r.route_label, r.feed_name].some((v) => v.toLowerCase().includes(q)));
  }, [query, routes]);

  const importFromUrl = async () => {
    if (!/^https?:\/\/\S+$/i.test(url.trim())) { setError('路線情報ページの URL を入力してください'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api.gtfsImportFromPage({ url: url.trim(), name: name.trim() || undefined });
      setMsg(`「${r.feed.name}」を取り込みました（停留所 ${r.feed.stop_count} / 便 ${r.feed.trip_count}）。`);
      setUrl(''); setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '路線情報の取り込みに失敗しました');
    } finally { setBusy(false); }
  };

  const removeFeed = async (id: string) => {
    if (!window.confirm('この取り込み済み路線情報を削除しますか？')) return;
    setError(''); setMsg('');
    try {
      await api.gtfsDeleteFeed(id);
      await load();
      if (selected?.feed_id === id) {
        setSelected(null);
        onSelectedRouteChange?.(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  return (
    <section className="route-panel">
      {error && <div className="card error">⚠ {error}</div>}
      {msg && <div className="card">{msg}</div>}

      <RoutePreviewSection tripId={tripId} map={map} />

      <div className="card route-list-panel">
        <div className="spread">
          <h3 style={{ margin: 0 }}>路線一覧</h3>
          <span className="chip">{routes.length}路線</span>
        </div>
        <div className="route-day-tabs" role="group" aria-label="ダイヤ">
          {(['weekday', 'weekend', 'holiday'] as const).map((k) => (
            <button key={k} type="button" className={dayKind === k ? 'chip-btn active' : 'chip-btn'} onClick={() => setDayKind(k)}>
              {DAY_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="路線名で検索"
          aria-label="路線検索"
        />

        {filteredRoutes.length === 0 && <p className="muted">取り込み済みの路線がありません。下の「経路取り込み」から追加してください。</p>}
        <div className="route-list">
          {filteredRoutes.map((r) => {
            const count = countForKind(r, dayKind);
            const active = selected?.feed_id === r.feed_id && selected.route_id === r.route_id;
            return (
              <button
                key={`${r.feed_id}:${r.route_id}`}
                type="button"
                className={`route-row${active ? ' active' : ''}${r.limited ? ' limited' : ''}${count === 0 ? ' muted-route' : ''}`}
                onClick={() => setSelected(r)}
              >
                <span className="route-row-main">
                  <strong>{routeIcon(r)} {r.route_label}</strong>
                  <span className="muted">{r.feed_name}</span>
                </span>
                <span className={`chip ${r.limited ? 'limited-chip' : ''}`}>
                  {count > 0 ? `${DAY_KIND_LABEL[dayKind]} ${count}便` : `${DAY_KIND_LABEL[dayKind]}なし`}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="route-detail">
            <div className="spread">
              <strong>{routeIcon(selected)} {selected.route_label}</strong>
              {selected.limited && <span className="chip limited-chip">限定ダイヤあり</span>}
            </div>
            <p className="muted" style={{ margin: '2px 0 8px' }}>
              表示ダイヤ: {DAY_KIND_LABEL[dayKind]} / {selectedDate.replaceAll('-', '/')} ・ 地図に常時表示
            </p>
            <GtfsTimetable
              feedId={selected.feed_id}
              routeId={selected.route_id}
              routeLabel={selected.route_label}
              routeType={selected.route_type}
              date={selectedDate}
              showMap={!map}
              compact
            />
          </div>
        )}
      </div>

      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>経路取り込み</h3>
        <label htmlFor="route-import-url">路線情報ページの URL</label>
        <input
          id="route-import-url"
          type="url"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="表示名（任意）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={() => void importFromUrl()} disabled={busy || !url.trim()}>
          {busy ? '取り込み中…' : 'URLから取り込む'}
        </button>

        {feeds.length > 0 && (
          <details className="route-imported">
            <summary>取り込み済み ({feeds.length})</summary>
            <div className="stack">
              {feeds.map((f) => (
                <div key={f.id} className="spread route-imported-row">
                  <span>
                    <strong>{f.name}</strong>
                    <span className="muted">停留所 {f.stop_count} / 便 {f.trip_count}</span>
                  </span>
                  <button type="button" className="sm ghost" onClick={() => void removeFeed(f.id)}>削除</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
