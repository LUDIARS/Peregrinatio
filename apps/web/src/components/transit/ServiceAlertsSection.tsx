import { useState } from 'react';
import { api } from '../../api.js';
import type { ServiceAlert, TransitProviderKind } from '../../types.js';
import { ProviderPicker, type TransitCfg } from './ProviderPicker.js';

/** 運行情報 (遅延/運休の手入力 + crawl-llm による自動更新)。 */
export function ServiceAlertsSection({
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
