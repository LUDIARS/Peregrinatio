import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collectImageFiles, enrichFromImages, enrichFromUrl, isUrl } from '../lib/enrich.js';

/**
 * 情報追加 — 「場所の情報を追加する」。
 * 受け取ったものが URL か画像かで処理を分岐する (インテリジェント検索同様)。
 *   URL  → クロール→要約
 *   画像 → 貼り付け/選択して連結→vision 解析
 * 完了したら新しい場所として登録され、マップとメモで確認できる。
 */
export function AddInfo() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  if (!tripId) return null;

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = collectImageFiles(e.clipboardData.items);
    if (imgs.length > 0) { e.preventDefault(); setImages((prev) => [...prev, ...imgs]); }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imgs = collectImageFiles(e.target.files);
    if (imgs.length > 0) setImages((prev) => [...prev, ...imgs]);
    e.target.value = '';
  };

  const run = async () => {
    setBusy(true); setMsg(''); setError('');
    try {
      if (images.length > 0) {
        const { id } = await enrichFromImages(tripId, null, images);
        setImages([]);
        setMsg('画像を解析して新しい場所を追加しました。');
        navigate(`/trips/${tripId}/places/${id}`);
      } else if (isUrl(url)) {
        const { id } = await enrichFromUrl(tripId, null, url.trim());
        setUrl('');
        setMsg('URL を要約して新しい場所を追加しました。');
        navigate(`/trips/${tripId}/places/${id}`);
      } else {
        setError('URL を入力するか、画像を貼り付け/選択してください。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました');
    } finally { setBusy(false); }
  };

  const canRun = images.length > 0 || isUrl(url);
  const runLabel = images.length > 0
    ? (busy ? '解析中…' : `画像を解析して追加 (${images.length})`)
    : (busy ? '取り込み中…' : 'URL を取り込んで追加');

  return (
    <div className="page-narrow">
      <div className="crumb"><Link to={`/trips/${tripId}`}>← マップとメモへ</Link></div>
      <h2>➕ 場所の情報を追加する</h2>
      <p className="muted">
        URL を入力するか、画像を貼り付け/選択してください。受け取ったものに応じて
        要約 (URL) または画像解析 (画像) を行い、新しい場所として登録します。
      </p>

      <div className="card foundation-form">
        <label htmlFor="add-url">URL から追加</label>
        <input id="add-url" type="url" placeholder="https://example.com/..." value={url}
          onChange={(e) => setUrl(e.target.value)} onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && canRun) void run(); }} />

        <label style={{ marginTop: 12 }}>画像から追加 (貼り付け or 選択)</label>
        <input type="file" accept="image/*" multiple onChange={onPick} />
        {images.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            {images.map((f, i) => (
              <img key={i} className="thumb" src={URL.createObjectURL(f)} alt={`選択 ${i}`}
                style={{ width: 52, aspectRatio: '1 / 1' }} />
            ))}
            <button type="button" className="sm ghost" onClick={() => setImages([])}>クリア</button>
          </div>
        )}

        <button type="button" onClick={() => void run()} disabled={busy || !canRun} style={{ marginTop: 12 }}>
          {runLabel}
        </button>
        {msg && <div className="muted">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <p className="muted">
        既存の場所に情報を足したい場合は、マップとメモでその場所を開いてから操作してください。
        キーワードで施設を探すには「マップとメモ」の地図上の「場所を検索」を使います。
      </p>
    </div>
  );
}
