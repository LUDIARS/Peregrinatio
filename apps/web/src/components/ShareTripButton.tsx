import { useState } from 'react';
import { api } from '../api.js';

interface Props {
  tripId: string;
  className?: string;
}

export function ShareTripButton({ tripId, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [protectedByPassword, setProtected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const shareUrl = token ? `${window.location.origin}/s/${encodeURIComponent(token)}` : '';

  const show = async () => {
    setOpen(true); setMessage('');
    try {
      const config = await api.getTripShare(tripId);
      if (config) { setToken(config.token); setProtected(config.password_protected); }
    } catch (e) { setMessage(e instanceof Error ? e.message : '共有設定を読み込めませんでした'); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const config = await api.configureTripShare(tripId, password.trim() ? password : null);
      setToken(config.token); setProtected(config.password_protected); setPassword('');
      setMessage(config.password_protected ? '合言葉つきの共有リンクを用意しました。' : '共有リンクを用意しました。');
    } catch (e) { setMessage(e instanceof Error ? e.message : '共有設定を保存できませんでした'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setMessage('リンクをコピーしました。'); }
    catch (e) { setMessage(e instanceof Error ? `コピーできませんでした: ${e.message}` : 'リンクをコピーできませんでした'); }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => void show()}>🔗 リンクを共有</button>
      {open && (
        <div className="share-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="share-modal card" role="dialog" aria-modal="true" aria-label="リンクを共有" onClick={(e) => e.stopPropagation()}>
            <div className="spread"><h3 style={{ margin: 0 }}>リンクを共有</h3><button type="button" className="icon-btn" onClick={() => setOpen(false)}>✕</button></div>
            {shareUrl && (
              <>
                <input type="text" value={shareUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={() => void copy()}>リンクをコピー</button>
                <p className="muted">現在: {protectedByPassword ? '合言葉あり' : '合言葉なし'}</p>
              </>
            )}
            <form className="foundation-form" onSubmit={save}>
              <label>{token ? '新しい合言葉（空欄で解除）' : '合言葉（任意）'}
                <input type="password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <button type="submit" disabled={busy}>{busy ? '保存中…' : token ? '共有設定を更新' : '共有リンクを作成'}</button>
            </form>
            {message && <p className="muted">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}
