import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import type { ImageAnalysis, Place, PlaceImage } from '../types.js';

export function PlaceDetail() {
  const { tripId, placeId } = useParams<{ tripId: string; placeId: string }>();
  const navigate = useNavigate();

  const [place, setPlace] = useState<Place | null>(null);
  const [images, setImages] = useState<PlaceImage[]>([]);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // 編集フォーム
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [summary, setSummary] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');

  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadPlace = async () => {
    if (!tripId || !placeId) return;
    const detail = await api.getTrip(tripId);
    const p = detail.places.find((x) => x.id === placeId) ?? null;
    if (!p) { setError('この場所が見つかりません'); return; }
    setPlace(p);
    setName(p.name);
    setAddress(p.address ?? '');
    setSummary(p.summary ?? '');
    if (p.source_url) setCrawlUrl(p.source_url);
  };

  const loadImages = async () => {
    if (!placeId) return;
    setImages(await api.listImages(placeId));
  };

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadPlace(), loadImages()]); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, placeId]);

  const save = async () => {
    if (!placeId) return;
    setBusy('save');
    setError('');
    try {
      const p = await api.patchPlace(placeId, {
        name: name.trim(),
        address: address.trim() || null,
        summary: summary.trim() || null,
      });
      setPlace(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally { setBusy(''); }
  };

  const crawl = async () => {
    if (!placeId) return;
    setBusy('crawl');
    setError('');
    try {
      const p = await api.crawlPlace(placeId, { url: crawlUrl.trim() || undefined });
      setPlace(p);
      setName(p.name);
      setAddress(p.address ?? '');
      setSummary(p.summary ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'クロール/要約に失敗しました');
    } finally { setBusy(''); }
  };

  const upload = async (files: FileList | null) => {
    if (!placeId || !files || files.length === 0) return;
    setBusy('upload');
    setError('');
    try {
      await api.uploadImages(placeId, Array.from(files));
      await loadImages();
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました');
    } finally { setBusy(''); }
  };

  const compose = async () => {
    if (!placeId) return;
    setBusy('compose');
    setError('');
    try {
      await api.composeImages(placeId, 'rtl');
      await loadImages();
    } catch (e) {
      setError(e instanceof Error ? e.message : '連結に失敗しました');
    } finally { setBusy(''); }
  };

  const analyze = async (imageId: string) => {
    setBusy('analyze');
    setError('');
    try {
      const a = await api.analyzeImage(imageId);
      setAnalysis(a);
      await loadPlace(); // 住所判明時はサーバが lat/lng を補完しているので取り直す
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像解析に失敗しました');
    } finally { setBusy(''); }
  };

  const remove = async () => {
    if (!placeId || !tripId) return;
    if (!window.confirm('この場所を削除しますか?')) return;
    try {
      await api.deletePlace(placeId);
      navigate(`/trips/${tripId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  if (!tripId || !placeId) return null;
  if (error && !place) return <div className="card error">⚠ {error}</div>;
  if (!place) return <p className="muted">読み込み中…</p>;

  const sources = images.filter((i) => i.kind === 'source').sort((a, b) => a.order_index - b.order_index);
  const composites = images.filter((i) => i.kind === 'composite');
  const latestComposite = composites[composites.length - 1];

  return (
    <div>
      <div className="crumb"><Link to={`/trips/${tripId}`}>← {place.name}</Link></div>

      {/* 基本情報 編集 */}
      <h2>{place.name}</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        {place.category && <span className="chip">{place.category}</span>}
        {place.lat != null && place.lng != null
          ? <span className="chip">📍 {place.lat.toFixed(4)}, {place.lng.toFixed(4)}</span>
          : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
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

      {/* Webからサマる */}
      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>Web からサマる</h3>
        <input type="url" placeholder="https://… (省略時は名前から検索)"
          value={crawlUrl} onChange={(e) => setCrawlUrl(e.target.value)} />
        <button type="button" onClick={() => void crawl()} disabled={busy === 'crawl'}>
          {busy === 'crawl' ? 'サマリ生成中…' : 'クロールして要約'}
        </button>
        <p className="muted">本文を取得→LLM で要約し、サマリ・カテゴリ・住所を更新します（住所が取れたらピン化）。</p>
      </div>

      {/* 画像: 連番アップロード → 右→左連結 → 解析 */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>画像 (Kindle 連番など)</h3>
        <input ref={fileRef} type="file" accept="image/*" multiple
          onChange={(e) => void upload(e.target.files)} />
        {busy === 'upload' && <p className="muted">アップロード中…</p>}

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
              <p className="muted">
                抽出住所: {analysis.extracted_address}
                {analysis.extracted_lat != null
                  ? '（ピンを立てました）'
                  : '（地図化できませんでした）'}
              </p>
            )}
          </div>
        )}
      </div>

      {error && <div className="card error">⚠ {error}</div>}
    </div>
  );
}
