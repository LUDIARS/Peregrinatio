import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { GtfsPanel } from '../GtfsPanel.js';
import { ReservationSuggests } from './ReservationSuggests.js';
import { TimetableSection } from './TimetableSection.js';
import { ServiceAlertsSection } from './ServiceAlertsSection.js';
import type { TransitCfg } from './ProviderPicker.js';
import type { ReservationSuggestion, SelectedGtfsRoute, ServiceAlert, Timetable, TimetableDeparture } from '../../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 時刻表 / 運行情報パネル (マップ画面の左パネル「経路」モード)。
 * 旧 /trips/:tripId/transit ページの内容をメイン画面へ統合したもの。
 * GTFS 路線の停留所・順路は `map` (メインの Google 地図) に直接描画し、
 * 地図を見ながら時刻表を確認できるようにする。
 */
export function TransitPanel(
  { tripId, map, selectedRoute, onSelectedRouteChange }:
  { tripId: string; map?: any; selectedRoute?: SelectedGtfsRoute | null; onSelectedRouteChange?: (route: SelectedGtfsRoute | null) => void },
) {
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [depByTt, setDepByTt] = useState<Record<string, TimetableDeparture[]>>({});
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [cfg, setCfg] = useState<TransitCfg>({ providers: ['crawl-llm'], default: 'crawl-llm', ekispertEnabled: false });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // 予約サジェスト (新幹線/飛行機)。出発地点+目的地の座標から特定する。
  const [suggests, setSuggests] = useState<ReservationSuggestion[]>([]);
  const [suggestOrigin, setSuggestOrigin] = useState<string | null>(null);

  const load = async () => {
    const [tts, als] = await Promise.all([api.listTimetables(tripId), api.listServiceAlerts(tripId)]);
    setTimetables(tts);
    setAlerts(als);
    const deps = await Promise.all(tts.map((t) => api.listDepartures(t.id)));
    const map: Record<string, TimetableDeparture[]> = {};
    tts.forEach((t, i) => { map[t.id] = deps[i] ?? []; });
    setDepByTt(map);
    // 予約サジェストは best-effort (座標未設定などで空でも本体は壊さない)。
    try {
      const r = await api.reservationSuggestions(tripId);
      setSuggests(r.suggestions);
      setSuggestOrigin(r.origin);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
        try { setCfg(await api.getTransitConfig()); } catch { /* 既定 crawl-llm のまま */ }
      }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  return (
    <div className="transit-panel">
      {error && <div className="card error">⚠ {error}</div>}
      {info && <div className="card">{info}</div>}

      <GtfsPanel
        tripId={tripId}
        map={map}
        selectedRoute={selectedRoute}
        onSelectedRouteChange={onSelectedRouteChange}
      />

      {/* 予約サジェスト (新幹線/飛行機) */}
      <ReservationSuggests suggests={suggests} origin={suggestOrigin} />

      {/* 時刻表 (手入力 + 自動取得) */}
      <TimetableSection
        tripId={tripId}
        timetables={timetables}
        depByTt={depByTt}
        cfg={cfg}
        onReload={load}
        onInfo={setInfo}
        onError={setError}
      />

      {/* 運行情報 */}
      <ServiceAlertsSection tripId={tripId} alerts={alerts} cfg={cfg} onReload={load} onInfo={setInfo} onError={setError} />
    </div>
  );
}
