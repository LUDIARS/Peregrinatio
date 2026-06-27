import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TimetableKind, TransitProviderKind } from '../types.js';

const KIND_LABEL: Record<TimetableKind, string> = { shinkansen: '新幹線', bus: 'バス', train: '電車' };
const KIND_OPTS: TimetableKind[] = ['shinkansen', 'train', 'bus'];
const PROVIDER_LABEL: Record<TransitProviderKind, string> = {
  'crawl-llm': 'URL から自動抽出',
  ekispert: '駅すぱあと',
};

interface TransitCfg {
  providers: TransitProviderKind[];
  default: TransitProviderKind;
  ekispertEnabled: boolean;
}

/**
 * 時刻表 / 運行情報。
 * - 時刻表: 区間 (from→to) を登録し、便を手入力で並べる。自動取得 (fetch) は provider で実装:
 *   crawl-llm = 時刻表ページ URL をクロール→LLM 抽出 (キー不要) / ekispert = 駅すぱあと契約 (区間 from/to)。
 * - 運行情報: 遅延/運休などを手入力で記録。更新 (refresh) は crawl-llm が運行情報ページ URL から抽出。
 */
export function Transit() {
  const { tripId } = useParams<{ tripId: string }>();
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [depByTt, setDepByTt] = useState<Record<string, TimetableDeparture[]>>({});
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [cfg, setCfg] = useState<TransitCfg>({ providers: ['crawl-llm'], default: 'crawl-llm', ekispertEnabled: false });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // 時刻表 追加フォーム
  const [ttKind, setTtKind] = useState<TimetableKind>('train');
  const [ttLine, setTtLine] = useState('');
  const [ttFrom, setTtFrom] = useState('');
  const [ttTo, setTtTo] = useState('');

  const load = async () => {
    if (!tripId) return;
    const [tts, als] = await Promise.all([api.listTimetables(tripId), api.listServiceAlerts(tripId)]);
    setTimetables(tts);
    setAlerts(als);
    const deps = await Promise.all(tts.map((t) => api.listDepartures(t.id)));
    const map: Record<string, TimetableDeparture[]> = {};
    tts.forEach((t, i) => { map[t.id] = deps[i] ?? []; });
    setDepByTt(map);
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

  if (!tripId) return null;

  const addTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    try {
      await api.createTimetable(tripId, {
        kind: ttKind, line_name: ttLine.trim() || undefined,
        from_station: ttFrom.trim() || undefined, to_station: ttTo.trim() || undefined,
      });
      setTtLine(''); setTtFrom(''); setTtTo('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '時刻表の追加に失敗しました'); }
  };

  const removeTimetable = async (id: string) => {
    if (!window.confirm('この時刻表を削除しますか?')) return;
    try { await api.deleteTimetable(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  return (
    <div className="page-narrow">
      <div className="crumb"><Link to={`/trips/${tripId}`}>← マップとメモへ</Link></div>
      <h2>🚃 時刻表 / 運行情報</h2>
      {error && <div className="card error">⚠ {error}</div>}
      {info && <div className="card">{info}</div>}

      {/* ── 時刻表 ───────────────────────────── */}
      <h3>時刻表</h3>
      <form className="card foundation-form" onSubmit={addTimetable}>
        <div className="row">
          <select value={ttKind} onChange={(e) => setTtKind(e.target.value as TimetableKind)}>
            {KIND_OPTS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input type="text" placeholder="路線名 (任意)" value={ttLine} onChange={(e) => setTtLine(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row">
          <input type="text" placeholder="出発" value={ttFrom} onChange={(e) => setTtFrom(e.target.value)} style={{ flex: 1 }} />
          <span style={{ alignSelf: 'center' }}>→</span>
          <input type="text" placeholder="到着" value={ttTo} onChange={(e) => setTtTo(e.target.value)} style={{ flex: 1 }} />
        </div>
        <button type="submit">＋ 区間を追加</button>
      </form>

      {timetables.length === 0 && <p className="muted">まだ時刻表がありません。区間を追加してください。</p>}
      {timetables.map((t) => (
        <TimetableCard
          key={t.id}
          timetable={t}
          departures={depByTt[t.id] ?? []}
          cfg={cfg}
          onReload={load}
          onDelete={() => void removeTimetable(t.id)}
          onInfo={setInfo}
          onError={setError}
        />
      ))}

      {/* ── 運行情報 ─────────────────────────── */}
      <ServiceAlerts tripId={tripId} alerts={alerts} cfg={cfg} onReload={load} onInfo={setInfo} onError={setError} />
    </div>
  );
}

// ── 取得方法 (provider) と URL の入力 ───────────────────────────────────────
function ProviderPicker({
  cfg, provider, setProvider, url, setUrl, urlPlaceholder,
}: {
  cfg: TransitCfg;
  provider: TransitProviderKind;
  setProvider: (p: TransitProviderKind) => void;
  url: string;
  setUrl: (u: string) => void;
  urlPlaceholder: string;
}) {
  return (
    <>
      {cfg.providers.length > 1 && (
        <select value={provider} onChange={(e) => setProvider(e.target.value as TransitProviderKind)} aria-label="取得方法">
          {cfg.providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
        </select>
      )}
      {provider === 'crawl-llm' && (
        <input
          type="url"
          placeholder={urlPlaceholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
      )}
    </>
  );
}

// ── 時刻表カード (区間 + 便の手入力 + 自動取得) ──────────────────────────────
function TimetableCard({
  timetable, departures, cfg, onReload, onDelete, onInfo, onError,
}: {
  timetable: Timetable;
  departures: TimetableDeparture[];
  cfg: TransitCfg;
  onReload: () => Promise<void>;
  onDelete: () => void;
  onInfo: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [dep, setDep] = useState('');
  const [arr, setArr] = useState('');
  const [train, setTrain] = useState('');
  const [fare, setFare] = useState('');
  const [provider, setProvider] = useState<TransitProviderKind>(cfg.default);
  const [fetchUrl, setFetchUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const runFetch = async () => {
    setBusy(true); onError(''); onInfo('');
    try {
      const r = await api.fetchTimetable(timetable.id, {
        provider,
        url: fetchUrl.trim() || undefined,
      });
      onInfo(`${r.added} 件の便を取得しました (${PROVIDER_LABEL[r.provider as TransitProviderKind] ?? r.provider})`);
      setFetchUrl('');
      await onReload();
    } catch (e) {
      // 握り潰さず案内表示 (url 未指定=400 / ekispert 未設定=501 等)。
      onError(e instanceof Error ? e.message : '自動取得に失敗しました');
    } finally { setBusy(false); }
  };

  const addDeparture = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addDeparture(timetable.id, {
        depart_time: dep || undefined, arrive_time: arr || undefined,
        train_name: train.trim() || undefined, fare_text: fare.trim() || undefined,
      });
      setDep(''); setArr(''); setTrain(''); setFare('');
      await onReload();
    } catch (e) { onError(e instanceof Error ? e.message : '便の追加に失敗しました'); }
  };

  const removeDeparture = async (id: string) => {
    try { await api.deleteDeparture(id); await onReload(); }
    catch (e) { onError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  return (
    <div className="card">
      <div className="spread">
        <strong>
          {KIND_LABEL[timetable.kind]}
          {timetable.line_name ? ` ${timetable.line_name}` : ''}
          {timetable.from_station || timetable.to_station
            ? ` ｜ ${timetable.from_station ?? '?'} → ${timetable.to_station ?? '?'}` : ''}
        </strong>
        <button type="button" className="sm danger" onClick={onDelete}>🗑</button>
      </div>

      {/* 自動取得: provider 選択 + (crawl-llm は) 時刻表ページ URL。 */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <ProviderPicker
          cfg={cfg} provider={provider} setProvider={setProvider}
          url={fetchUrl} setUrl={setFetchUrl} urlPlaceholder="時刻表ページの URL"
        />
        <button type="button" className="sm ghost" disabled={busy} onClick={() => void runFetch()}>
          {busy ? '取得中…' : '自動取得'}
        </button>
      </div>

      {departures.length === 0
        ? <p className="muted" style={{ margin: '6px 0' }}>便がありません。下のフォームで追加してください。</p>
        : (
          <div className="stack" style={{ marginTop: 6 }}>
            {departures.map((d) => (
              <div key={d.id} className="spread tt-dep">
                <span>
                  <strong>{d.depart_time ?? '—'}</strong>
                  {d.arrive_time ? ` → ${d.arrive_time}` : ''}
                  {d.train_name ? ` ｜ ${d.train_name}` : ''}
                  {d.fare_text ? ` ｜ ${d.fare_text}` : ''}
                </span>
                <button type="button" className="sm danger" onClick={() => void removeDeparture(d.id)}>🗑</button>
              </div>
            ))}
          </div>
        )}

      <form className="foundation-form" onSubmit={addDeparture} style={{ marginTop: 8 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input type="time" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="出発時刻" />
          <input type="time" value={arr} onChange={(e) => setArr(e.target.value)} aria-label="到着時刻" />
          <input type="text" placeholder="便名 (任意)" value={train} onChange={(e) => setTrain(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
          <input type="text" placeholder="運賃 (任意)" value={fare} onChange={(e) => setFare(e.target.value)} style={{ width: 110 }} />
          <button type="submit" className="sm">＋ 便</button>
        </div>
      </form>
    </div>
  );
}

// ── 運行情報 ───────────────────────────────────────────────────────────────
function ServiceAlerts({
  tripId, alerts, cfg, onReload, onInfo, onError,
}: {
  tripId: string;
  alerts: ServiceAlert[];
  cfg: TransitCfg;
  onReload: () => Promise<void>;
  onInfo: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [line, setLine] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');
  // 運行情報は crawl-llm のみ対応 (ekispert は未対応で 501)。provider 選択肢から ekispert は除く。
  const alertProviders = cfg.providers.filter((p) => p !== 'ekispert');
  const alertCfg: TransitCfg = { ...cfg, providers: alertProviders, default: 'crawl-llm' };
  const [provider, setProvider] = useState<TransitProviderKind>('crawl-llm');
  const [refreshUrl, setRefreshUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addServiceAlert(tripId, {
        line_name: line.trim() || undefined, severity,
        title: title.trim() || undefined, body: body.trim() || undefined,
      });
      setLine(''); setTitle(''); setBody(''); setSeverity('info');
      await onReload();
    } catch (e) { onError(e instanceof Error ? e.message : '運行情報の追加に失敗しました'); }
  };

  const remove = async (id: string) => {
    try { await api.deleteServiceAlert(id); await onReload(); }
    catch (e) { onError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  const refresh = async () => {
    setBusy(true); onError(''); onInfo('');
    try {
      const r = await api.refreshServiceAlerts(tripId, {
        provider,
        url: refreshUrl.trim() || undefined,
        line_name: line.trim() || undefined,
      });
      onInfo(`${r.added} 件の運行情報を取得しました`);
      setRefreshUrl('');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : '自動更新に失敗しました');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="spread" style={{ marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>運行情報</h3>
      </div>
      {/* 自動更新: 運行情報ページ URL をクロール→LLM 抽出 (crawl-llm)。 */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0 8px' }}>
        <ProviderPicker
          cfg={alertCfg} provider={provider} setProvider={setProvider}
          url={refreshUrl} setUrl={setRefreshUrl} urlPlaceholder="運行情報ページの URL"
        />
        <button type="button" className="sm ghost" disabled={busy} onClick={() => void refresh()}>
          {busy ? '更新中…' : '自動更新'}
        </button>
      </div>

      {alerts.length === 0 && <p className="muted">登録された運行情報はありません。</p>}
      <div className="stack">
        {alerts.map((a) => (
          <div key={a.id} className="card">
            <div className="spread">
              <strong>
                <span className={`chip severity-${a.severity}`}>{a.severity}</span>
                {a.line_name ? ` ${a.line_name}` : ''} {a.title ?? ''}
              </strong>
              <button type="button" className="sm danger" onClick={() => void remove(a.id)}>🗑</button>
            </div>
            {a.body && <p className="muted" style={{ margin: '4px 0 0' }}>{a.body}</p>}
          </div>
        ))}
      </div>

      <form className="card foundation-form" onSubmit={add}>
        <div className="row">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="info">情報</option>
            <option value="warning">注意</option>
            <option value="suspended">運休</option>
            <option value="normal">平常</option>
          </select>
          <input type="text" placeholder="路線名 (任意)" value={line} onChange={(e) => setLine(e.target.value)} style={{ flex: 1 }} />
        </div>
        <input type="text" placeholder="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="詳細 (任意)" value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="submit">＋ 運行情報を追加</button>
      </form>
    </>
  );
}
