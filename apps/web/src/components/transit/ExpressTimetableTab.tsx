// @implements SPEC-EXPRESS-UI
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { ExpressImportPayload, ExpressLineDetail, ExpressLineSummary } from '../../types.js';
import { ExpressImportForm } from './ExpressImportForm.js';
import { ExpressStationCoords } from './ExpressStationCoords.js';
import { ExpressTimetableGrid } from './ExpressTimetableGrid.js';
import { ExpressTripSuggest } from './ExpressTripSuggest.js';

const KIND_LABEL = { shinkansen: '新幹線', limited_express: '特急' } as const;

/** 取り込みプレビュー: 解析結果と駅座標の手修正。保存して初めてライブラリに入る。 */
function ImportPreview({
  payload, onChange, onSave, onCancel, busy,
}: {
  payload: ExpressImportPayload;
  onChange: (p: ExpressImportPayload) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="card stack">
      <div className="spread">
        <strong>プレビュー: {payload.line.name} ({KIND_LABEL[payload.line.kind]})</strong>
        <span className="chip">{payload.stations.length} 駅 / {payload.trains.length} 本</span>
      </div>
      {payload.line.valid_from && <div className="muted">ダイヤ改正日 {payload.line.valid_from}</div>}
      {payload.warnings.map((w) => <div key={w} className="muted">⚠ {w}</div>)}
      <ExpressTimetableGrid stations={payload.stations} trains={payload.trains} direction="down" />
      <ExpressTimetableGrid stations={payload.stations} trains={payload.trains} direction="up" />
      <strong>駅の座標</strong>
      <ExpressStationCoords
        stations={payload.stations}
        onSave={(seq, coords) => onChange({
          ...payload,
          stations: payload.stations.map((s) => (s.seq === seq ? { ...s, ...coords } : s)),
        })}
      />
      <div className="row">
        <button type="button" disabled={busy} onClick={onSave}>{busy ? '保存中…' : 'ライブラリに保存'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>やめる</button>
      </div>
    </div>
  );
}

/** 保存済み路線の詳細 (表と駅座標の手修正)。 */
function LineDetail({ line, onReload, onError }: { line: ExpressLineDetail; onReload: () => Promise<void>; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card stack">
      <strong>{line.name} ({KIND_LABEL[line.kind]})</strong>
      <div className="muted">
        {[line.operator, line.valid_from ? `${line.valid_from} 改正` : 'ダイヤ改正日 不明', line.notes].filter(Boolean).join(' ／ ')}
        {line.source_url && <> ／ <a href={line.source_url} target="_blank" rel="noreferrer">出典</a></>}
      </div>
      <ExpressTimetableGrid stations={line.stations} trains={line.trains} direction="down" />
      <ExpressTimetableGrid stations={line.stations} trains={line.trains} direction="up" />
      <strong>駅の座標</strong>
      <ExpressStationCoords
        stations={line.stations}
        busy={busy}
        onSave={async (seq, coords) => {
          setBusy(true);
          try { await api.updateExpressStation(line.id, seq, coords); await onReload(); }
          catch (e) { onError(e instanceof Error ? e.message : '座標を保存できませんでした'); }
          finally { setBusy(false); }
        }}
      />
    </div>
  );
}

/**
 * 「時刻表・運行情報」の「新幹線・特急の時刻表」タブ。
 * 路線一覧 / 取り込み (貼り付け or URL) / プレビュー表 / 駅座標の手修正 / この旅の往復便の提案。
 * 時刻表は旅をまたいで共有するライブラリ (旅を消しても残る)。
 */
export function ExpressTimetableTab({ tripId, onBoardChanged }: { tripId: string; onBoardChanged: () => Promise<void> }) {
  const [lines, setLines] = useState<ExpressLineSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExpressLineDetail | null>(null);
  const [preview, setPreview] = useState<ExpressImportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadLines = async () => setLines(await api.listExpressLines());
  const loadDetail = async (id: string) => setDetail(await api.getExpressLine(id));

  useEffect(() => {
    loadLines().catch((e: unknown) => setError(e instanceof Error ? e.message : '路線一覧を読めませんでした'));
  }, []);

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    try { await loadDetail(id); } catch (e) { setError(e instanceof Error ? e.message : '路線を読めませんでした'); }
  };

  const remove = async (l: ExpressLineSummary) => {
    if (!window.confirm(`「${l.name}」を時刻表ライブラリから削除しますか? (旅の区間ボードに写した便は残ります)`)) return;
    try {
      await api.deleteExpressLine(l.id);
      if (openId === l.id) { setOpenId(null); setDetail(null); }
      await loadLines();
    } catch (e) { setError(e instanceof Error ? e.message : '削除できませんでした'); }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const r = await api.saveExpressImport(preview);
      setInfo(`${r.line.name} を保存しました (${r.line.trains.length} 本)。`);
      setPreview(null);
      await loadLines();
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {error && <div className="card error">⚠ {error}</div>}
      {info && <div className="card">{info}</div>}

      <ExpressTripSuggest tripId={tripId} onAdopted={onBoardChanged} onError={setError} />

      <h3 style={{ margin: '8px 0 0' }}>新幹線・特急の時刻表ライブラリ</h3>
      {lines.length === 0 && <p className="muted">まだ路線がありません。下のフォームから取り込んでください。</p>}
      {lines.map((l) => (
        <div key={l.id} className="card">
          <div className="spread">
            <button type="button" className="ghost" onClick={() => void toggle(l.id)} style={{ textAlign: 'left' }}>
              <strong>{openId === l.id ? '▾' : '▸'} {l.name}</strong>{' '}
              <span className="muted">{KIND_LABEL[l.kind]} ／ {l.station_count} 駅 ／ {l.train_count} 本{l.valid_from ? ` ／ ${l.valid_from} 改正` : ''}</span>
            </button>
            <button type="button" className="sm danger" onClick={() => void remove(l)}>🗑</button>
          </div>
          {openId === l.id && detail && detail.id === l.id && (
            <LineDetail line={detail} onReload={() => loadDetail(l.id)} onError={setError} />
          )}
        </div>
      ))}

      {preview
        ? <ImportPreview payload={preview} onChange={setPreview} onSave={() => void save()} onCancel={() => setPreview(null)} busy={busy} />
        : <ExpressImportForm onPreview={(p) => { setInfo(''); setPreview(p); }} onError={setError} />}
    </div>
  );
}
