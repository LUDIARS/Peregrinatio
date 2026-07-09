import { useState } from 'react';
import { api } from '../../api.js';
import type { Timetable, TimetableDeparture, TimetableKind, TransitProviderKind } from '../../types.js';
import { ProviderPicker, PROVIDER_LABEL, type TransitCfg } from './ProviderPicker.js';

const KIND_LABEL: Record<TimetableKind, string> = { shinkansen: '新幹線', bus: 'バス', train: '電車' };
const KIND_OPTS: TimetableKind[] = ['shinkansen', 'train', 'bus'];

/**
 * 手入力/自動取得の時刻表 (区間 from→to + 便の一覧)。
 * 区間の追加フォームと、区間ごとのカード (便の追加・削除・自動取得) を表示する。
 */
export function TimetableSection({
  tripId, timetables, depByTt, cfg, onReload, onInfo, onError,
}: {
  tripId: string;
  timetables: Timetable[];
  depByTt: Record<string, TimetableDeparture[]>;
  cfg: TransitCfg;
  onReload: () => Promise<void>;
  onInfo: (m: string) => void;
  onError: (m: string) => void;
}) {
  // 時刻表 追加フォーム
  const [ttKind, setTtKind] = useState<TimetableKind>('train');
  const [ttLine, setTtLine] = useState('');
  const [ttFrom, setTtFrom] = useState('');
  const [ttTo, setTtTo] = useState('');
  const [busBusy, setBusBusy] = useState(false);

  const addTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(''); onInfo('');
    try {
      await api.createTimetable(tripId, {
        kind: ttKind, line_name: ttLine.trim() || undefined,
        from_station: ttFrom.trim() || undefined, to_station: ttTo.trim() || undefined,
      });
      setTtLine(''); setTtFrom(''); setTtTo('');
      await onReload();
    } catch (e) { onError(e instanceof Error ? e.message : '時刻表の追加に失敗しました'); }
  };

  const removeTimetable = async (id: string) => {
    if (!window.confirm('この時刻表を削除しますか?')) return;
    try { await api.deleteTimetable(id); await onReload(); }
    catch (e) { onError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  const seedTohokuShinkansen = async () => {
    onError(''); onInfo('');
    try {
      const r = await api.seedTohokuShinkansen(tripId);
      onInfo(`東北新幹線 なすの（東京〜那須塩原）を用意しました（追加 ${r.added} 件）`);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : '東北新幹線の時刻表を用意できませんでした');
    }
  };

  const suggestBusesForShinkansen = async () => {
    setBusBusy(true); onError(''); onInfo('');
    try {
      const r = await api.suggestBusesForTohokuShinkansen(tripId);
      onInfo(`新幹線に接続するバス候補を検索しました（行き ${r.outbound.length} 件 / 帰り ${r.inbound.length} 件、追加 ${r.added} 件）`);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : '新幹線に対応するバス候補を検索できませんでした');
    } finally {
      setBusBusy(false);
    }
  };

  return (
    <>
      <h3>時刻表</h3>
      <div className="card transit-preset">
        <div>
          <strong>東北新幹線 なすの 東京〜那須塩原</strong>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            JR東日本 PDF「東北新幹線 時刻表（3/19〜）」を元に、下り/上りをまとめて登録します。
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="sm" onClick={() => void seedTohokuShinkansen()}>
            用意する
          </button>
          <button type="button" className="sm ghost" disabled={busBusy} onClick={() => void suggestBusesForShinkansen()}>
            {busBusy ? '検索中…' : '対応バスを検索'}
          </button>
        </div>
      </div>
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
          onReload={onReload}
          onDelete={() => void removeTimetable(t.id)}
          onInfo={onInfo}
          onError={onError}
        />
      ))}
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
                  <span>
                    <strong>{d.depart_time ?? '—'}</strong>
                    {d.arrive_time ? ` → ${d.arrive_time}` : ''}
                    {d.train_name ? ` ｜ ${d.train_name}` : ''}
                    {d.fare_text ? ` ｜ ${d.fare_text}` : ''}
                  </span>
                  {d.note ? <small className="muted tt-note">{d.note}</small> : null}
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
