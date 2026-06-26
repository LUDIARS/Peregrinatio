import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import type { ImageAnalysis, Place, PlaceImage } from '../types.js';

interface PaneProps {
  tripId: string;
  placeId: string;
  onClose: () => void;
  /** place/list に影響する変更後 (保存/クロール/解析/削除) に呼ぶ。 */
  onChanged?: () => void;
}

/** 場所詳細ペーン (PC=右カラム / モバイル=ポップアップ / ルート=全画面 で共用)。 */
export function PlaceDetailPane({ tripId, placeId, onClose, onChanged }: PaneProps) {
  const [place, setPlace] = useState<Place | null>(null);
  const [images, setImages] = useState<PlaceImage[]>([]);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [summary, setSummary] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');

  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadPlace = async () => {
    const detail = await api.getTrip(tripId);
    const p = detail.places.find((x) => x.id === placeId) ?? null;
    if (!p) { setError('この場所が見つかりません'); return; }
    setPlace(p);
    setName(p.name);
    setAddress(p.address ?? '');
    setSummary(p.summary ?? '');
    setCrawlUrl(p.source_url ?? '');
  };

  const loadImages = async () => { setImages(await api.listImages(placeId)); };

  useEffect(() => {
    setAnalysis(null);
    (async () => {
      try { await Promise.all([loadPlace(), loadImages()]); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, placeId]);

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const p = await api.patchPlace(placeId, {
        name: name.trim(), address: address.trim() || null, summary: summary.trim() || null,
      });
      setPlace(p); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : '保存に失敗しました'); }
    finally { setBusy(''); }
  };

  const crawl = async () => {
    setBusy('crawl'); setError('');
    try {
      const p = await api.crawlPlace(placeId, { url: crawlUrl.trim() || undefined });
      setPlace(p); setName(p.name); setAddress(p.address ?? ''); setSummary(p.summary ?? '');
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'クロール/要約に失敗しました'); }
    finally { setBusy(''); }
  };

  const uploadFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    setBusy('upload'); setError('');
    try {
      await api.uploadImages(placeId, imgs);
      await loadImages();
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setError(e instanceof Error ? e.message : 'アップロードに失敗しました'); }
    finally { setBusy(''); }
  };
  const upload = (files: FileList | null) => uploadFiles(files ? Array.from(files) : []);

  const filesFromDataTransfer = (dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    const out: File[] = [];
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          const nm = f.name && f.name !== 'image.png' ? f.name : `paste-${Date.now()}.png`;
          out.push(new File([f], nm, { type: f.type }));
        }
      }
    }
    if (out.length === 0) out.push(...Array.from(dt.files).filter((f) => f.type.startsWith('image/')));
    return out;
  };
  const onPaste = (dt: DataTransfer | null) => {
    const imgs = filesFromDataTransfer(dt);
    if (imgs.length > 0) void uploadFiles(imgs);
    return imgs.length > 0;
  };

  // 詳細を開いている間、ページ全体の Ctrl+V (⌘+V) で貼り付け取り込み。
  useEffect(() => {
    const handler = (e: ClipboardEvent) => { if (onPaste(e.clipboardData)) e.preventDefault(); };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

  const compose = async () => {
    setBusy('compose'); setError('');
    try { await api.composeImages(placeId, 'rtl'); await loadImages(); }
    catch (e) { setError(e instanceof Error ? e.message : '連結に失敗しました'); }
    finally { setBusy(''); }
  };

  const analyze = async (imageId: string) => {
    setBusy('analyze'); setError('');
    try {
      const a = await api.analyzeImage(imageId);
      setAnalysis(a);
      await loadPlace(); onChanged?.(); // 住所判明時はピンが立つので一覧/地図も更新
    } catch (e) { setError(e instanceof Error ? e.message : '画像解析に失敗しました'); }
    finally { setBusy(''); }
  };

  const toggleBase = async () => {
    if (!place) return;
    try { const p = await api.patchPlace(placeId, { is_base: place.is_base === 1 ? 0 : 1 }); setPlace(p); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : '拠点の更新に失敗しました'); }
  };

  const remove = async () => {
    if (!window.confirm('この場所を削除しますか?')) return;
    try { await api.deletePlace(placeId); onChanged?.(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  const sources = images.filter((i) => i.kind === 'source').sort((a, b) => a.order_index - b.order_index);
  const composites = images.filter((i) => i.kind === 'composite');
  const latestComposite = composites[composites.length - 1];

  return (
    <div className="detail-pane">
      <div className="detail-head">
        <strong className="detail-title">{place ? `${place.is_base === 1 ? '🏨 ' : ''}${place.name}` : '読み込み中…'}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">✕</button>
      </div>

      {error && !place && <div className="card error">⚠ {error}</div>}
      {place && (
        <div className="detail-body">
          <div className="row" style={{ marginBottom: 8 }}>
            {place.category && <span className="chip">{place.category}</span>}
            {place.lat != null && place.lng != null
              ? <span className="chip">📍 {place.lat.toFixed(4)}, {place.lng.toFixed(4)}</span>
              : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
            <button type="button" className="sm ghost" onClick={() => void toggleBase()}>
              {place.is_base === 1 ? '拠点解除' : '拠点にする'}
            </button>
          </div>

          <div className="card foundation-form">
            <h3 style={{ marginTop: 0 }}>基本情報</h3>
            <div>
              <label htmlFor="p-name">名前</label>
              <input id="p-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="p-addr">住所</label>
              <input id="p-addr" type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label htmlFor="p-sum">サマリ</label>
              <textarea id="p-sum" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="row">
              <button type="button" onClick={() => void save()} disabled={busy === 'save'}>
                {busy === 'save' ? '保存中…' : '保存'}
              </button>
              <button type="button" className="danger" onClick={() => void remove()}>削除</button>
            </div>
          </div>

          <div className="card foundation-form">
            <h3 style={{ marginTop: 0 }}>Web からサマる</h3>
            <input type="url" placeholder="https://… (省略時は名前から検索)"
              value={crawlUrl} onChange={(e) => setCrawlUrl(e.target.value)} />
            <button type="button" onClick={() => void crawl()} disabled={busy === 'crawl'}>
              {busy === 'crawl' ? 'サマリ生成中…' : 'クロールして要約'}
            </button>
            <p className="muted">本文を取得→LLM で要約し、サマリ・カテゴリ・住所を更新（住所が取れたらピン化）。</p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>画像 (Kindle 連番など)</h3>
            <div className="paste-zone" tabIndex={0} role="button"
              onClick={() => fileRef.current?.click()}
              onPaste={(e) => { if (onPaste(e.clipboardData)) e.preventDefault(); }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drag')}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag'); onPaste(e.dataTransfer); }}>
              <div className="paste-zone-main">📋 画像を貼り付け / ドラッグ＆ドロップ / タップして選択</div>
              <div className="muted">クリップボードの画像は <b>Ctrl + V</b>（Mac は ⌘ + V）で即追加。</div>
              {busy === 'upload' && <div className="muted">アップロード中…</div>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => void upload(e.target.files)} />

            {sources.length > 0 && (
              <>
                <h3>取り込み画像 ({sources.length})</h3>
                <div className="thumb-grid">
                  {sources.map((img) => (
                    <img key={img.id} className="thumb" src={assetUrl(img.path)} alt={`source ${img.order_index}`} />
                  ))}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => void compose()} disabled={busy === 'compose'}>
                    {busy === 'compose' ? '連結中…' : '右 → 左で連結'}
                  </button>
                </div>
              </>
            )}

            {latestComposite && (
              <>
                <h3>連結画像</h3>
                <img className="composite-img" src={assetUrl(latestComposite.path)} alt="composite" />
                <div className="row" style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => void analyze(latestComposite.id)} disabled={busy === 'analyze'}>
                    {busy === 'analyze' ? '解析中…' : '画像を解析'}
                  </button>
                </div>
              </>
            )}

            {analysis && (
              <div className="card" style={{ marginTop: 12 }}>
                <strong>解析結果</strong>
                {analysis.model && <span className="chip" style={{ marginLeft: 6 }}>{analysis.model}</span>}
                {analysis.analysis_text && <p style={{ whiteSpace: 'pre-wrap' }}>{analysis.analysis_text}</p>}
                {analysis.extracted_address && (
                  <p className="muted">抽出住所: {analysis.extracted_address}
                    {analysis.extracted_lat != null ? '（ピンを立てました）' : '（地図化できませんでした）'}</p>
                )}
              </div>
            )}
          </div>

          {error && <div className="card error">⚠ {error}</div>}
        </div>
      )}
    </div>
  );
}

/** 単独ルート (/trips/:id/places/:placeId) 用の全画面ラッパー (deep link)。 */
export function PlaceDetail() {
  const { tripId, placeId } = useParams<{ tripId: string; placeId: string }>();
  const navigate = useNavigate();
  if (!tripId || !placeId) return null;
  return (
    <PlaceDetailPane tripId={tripId} placeId={placeId} onClose={() => navigate(`/trips/${tripId}`)} />
  );
}
