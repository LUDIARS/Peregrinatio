// @implements SPEC-EXPRESS-UI
import { useState } from 'react';
import { api } from '../../api.js';
import type { ExpressImportPayload, ExpressLineKind } from '../../types.js';

const SAMPLE = '駅名\tなすの401号\tやまびこ51号\n東京\t6:20\t6:40\n大宮\t6:46\tレ\n那須塩原\t7:29\t7:35';

/**
 * 新幹線・特急の時刻表の取り込みフォーム。貼り付け (主経路・決定的) か URL (HTML / PDF を LLM で抽出)。
 * ここではプレビューを作るだけで保存しない。
 */
export function ExpressImportForm({
  onPreview, onError,
}: {
  onPreview: (payload: ExpressImportPayload) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<'paste' | 'url'>('paste');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExpressLineKind>('shinkansen');
  const [operator, setOperator] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [down, setDown] = useState('');
  const [up, setUp] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const line = {
    name: name.trim(), kind,
    operator: operator.trim() || null,
    valid_from: validFrom || null,
    source_url: (mode === 'url' ? url.trim() : sourceUrl.trim()) || null,
    notes: null,
  };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    onError('');
    setBusy(true);
    try {
      const payload = mode === 'paste'
        ? await api.previewExpressImport({
            mode: 'paste', line,
            tables: [
              ...(down.trim() ? [{ direction: 'down' as const, text: down }] : []),
              ...(up.trim() ? [{ direction: 'up' as const, text: up }] : []),
            ],
          })
        : await api.previewExpressImport({ mode: 'url', line, url: url.trim() });
      onPreview(payload);
    } catch (err) {
      // 取得・抽出の失敗は 502、入力不足は 400。どちらも理由をそのまま見せて貼り付けへ誘導する。
      onError(err instanceof Error ? err.message : 'プレビューを作れませんでした');
    } finally { setBusy(false); }
  };

  return (
    <form className="card foundation-form" onSubmit={run}>
      <strong>時刻表を取り込む</strong>
      <div className="row">
        <input type="text" placeholder="路線名 (例: 東北新幹線 / 特急ひたち)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as ExpressLineKind)}>
          <option value="shinkansen">新幹線</option>
          <option value="limited_express">特急</option>
        </select>
      </div>
      <div className="row">
        <input type="text" placeholder="事業者 (任意)" value={operator} onChange={(e) => setOperator(e.target.value)} style={{ flex: 1 }} />
        <label className="muted">ダイヤ改正日 <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
      </div>
      <div className="row">
        <label><input type="radio" checked={mode === 'paste'} onChange={() => setMode('paste')} /> 表を貼り付け</label>
        <label><input type="radio" checked={mode === 'url'} onChange={() => setMode('url')} /> URL / PDF から抽出</label>
      </div>
      {mode === 'paste' ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            1 行目に列車名、2 行目以降に「駅名, 時刻…」(表計算ソフトや PDF からのコピーはタブ区切りのまま)。
            通過は ↓ / レ / ||、非経由は空欄、着発は「着6:20 発6:22」か駅名を「大宮 着」「大宮 発」の 2 行に。
          </p>
          <textarea className="express-paste" placeholder={`下り (駅は起点→終点の順)\n${SAMPLE}`} value={down} onChange={(e) => setDown(e.target.value)} />
          <textarea className="express-paste" placeholder="上り (駅は上り方向の順。無ければ空のまま)" value={up} onChange={(e) => setUp(e.target.value)} />
          <input type="url" placeholder="出典 URL (任意)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </>
      ) : (
        <>
          <input type="url" placeholder="時刻表ページ または PDF の URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <p className="muted" style={{ margin: 0 }}>LLM で抽出します。駅順と時刻はプレビューで必ず確かめてください。</p>
        </>
      )}
      <button type="submit" disabled={busy || !name.trim() || (mode === 'paste' ? !down.trim() && !up.trim() : !url.trim())}>
        {busy ? '解析中…' : 'プレビュー'}
      </button>
    </form>
  );
}
