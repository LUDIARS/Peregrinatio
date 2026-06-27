import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { ServiceAlert, Timetable, TimetableDeparture, TimetableKind } from '../types.js';

const KIND_LABEL: Record<TimetableKind, string> = { shinkansen: '新幹線', bus: 'バス', train: '電車' };
const KIND_OPTS: TimetableKind[] = ['shinkansen', 'train', 'bus'];

/**
 * 時刻表 / 運行情報。
 * - 時刻表: 区間 (from→to) を登録し、便を手入力で並べる。自動取得 (fetch) はデータ源未配線のため
 *   501 を返す骨組み (将来 NAVITIME/駅すぱあと/ODPT を差し込む)。
 * - 運行情報: 遅延/運休などを手入力で記録。更新 (refresh) も同様に骨組み。
 */
export function Transit() {
  const { tripId } = useParams<{ tripId: string }>();
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [depByTt, setDepByTt] = useState<Record<string, TimetableDeparture[]>>({});
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
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
      try { await load(); }
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

  const fetchTimetable = async (id: string) => {
    setError(''); setInfo('');
    try {
      await api.fetchTimetable(id);
      await load();
    } catch (e) {
      // 既定はデータ源未配線で 501。メッセージを案内として表示 (握り潰さない)。
      setInfo(e instanceof Error ? e.message : '自動取得は未対応です。手入力で追加してください。');
    }
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
          onReload={load}
          onDelete={() => void removeTimetable(t.id)}
          onFetch={() => void fetchTimetable(t.id)}
          onError={setError}
        />
      ))}

      {/* ── 運行情報 ─────────────────────────── */}
      <ServiceAlerts tripId={tripId} alerts={alerts} onReload={load} onInfo={setInfo} onError={setError} />
    </div>
  );
}

// ── 時刻表カード (区間 + 便の手入力) ────────────────────────────────────────
function TimetableCard({
  timetable, departures, onReload, onDelete, onFetch, onError,
}: {
  timetable: Timetable;
  departures: TimetableDeparture[];
  onReload: () => Promise<void>;
  onDelete: () => void;
  onFetch: () => void;
  onError: (m: string) => void;
}) {
  const [dep, setDep] = useState('');
  const [arr, setArr] = useState('');
  const [train, setTrain] = useState('');
  const [fare, setFare] = useState('');

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
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="sm ghost" onClick={onFetch}>取得</button>
          <button type="button" className="sm danger" onClick={onDelete}>🗑</button>
        </div>
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
  tripId, alerts, onReload, onInfo, onError,
}: {
  tripId: string;
  alerts: ServiceAlert[];
  onReload: () => Promise<void>;
  onInfo: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [line, setLine] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');

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
    onInfo('');
    try { await api.refreshServiceAlerts(tripId); await onReload(); }
    catch (e) { onInfo(e instanceof Error ? e.message : '自動更新は未対応です。手入力で登録してください。'); }
  };

  return (
    <>
      <div className="spread" style={{ marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>運行情報</h3>
        <button type="button" className="sm ghost" onClick={() => void refresh()}>更新</button>
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
