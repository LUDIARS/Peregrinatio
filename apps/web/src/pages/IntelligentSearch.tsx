import { useState } from 'react';
import { api } from '../api.js';
import type { PlaceSearchResult, TripPlace } from '../types.js';

interface Props {
  tripId: string;
  /** いま右ペインで開いている場所 (= 情報を足す対象)。無ければ新規作成する。 */
  selectedPlace: TripPlace | null;
  /** 場所の追加/更新後に一覧・地図を更新する。 */
  onChanged: () => void | Promise<void>;
  /** 新規に作った/対象にした場所を選択させる (右ペインを開く)。 */
  onSelectPlace: (placeId: string) => void;
}

const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());
const hostOf = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
};

/**
 * インテリジェント検索 — 1 つの入力でテキスト / URL / 画像を受ける。
 * - テキスト(キーワード): Places 検索 → 候補をこの旅に追加。
 * - URL: クロール→LLM 要約して「対象の場所」に情報(サマリ/住所/画像)を付与。
 * - 画像(貼り付け/選択): 連結→vision 解析して「対象の場所」に住所/解析を付与。
 * 「対象の場所」= 右ペインで開いている場所。無ければ新規作成して開く。
 */
export function IntelligentSearch({ tripId, selectedPlace, onChanged, onSelectPlace }: Props) {
  const [q, setQ] = useState('');
  const [pasted, setPasted] = useState<File[]>([]);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const targetLabel = selectedPlace ? `「${selectedPlace.name}」に追加` : '新しい場所として追加';

  /** 情報付与の対象 place id を返す (未選択なら新規作成)。 */
  const ensureTarget = async (fallbackName: string): Promise<{ id: string; created: boolean }> => {
    if (selectedPlace) return { id: selectedPlace.id, created: false };
    const p = await api.addPlaceToTrip(tripId, { name: fallbackName });
    return { id: p.id, created: true };
  };

  const collectFiles = (list: FileList | DataTransferItemList | null): File[] => {
    if (!list) return [];
    const out: File[] = [];
    for (const item of Array.from(list as ArrayLike<unknown>)) {
      if (item instanceof File) { if (item.type.startsWith('image/')) out.push(item); continue; }
      const di = item as DataTransferItem;
      if (di.kind === 'file' && di.type.startsWith('image/')) {
        const f = di.getAsFile();
        if (f) out.push(new File([f], f.name && f.name !== 'image.png' ? f.name : `paste-${Date.now()}.png`, { type: f.type }));
      }
    }
    return out;
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = collectFiles(e.clipboardData.items);
    if (imgs.length > 0) { e.preventDefault(); setPasted((prev) => [...prev, ...imgs]); }
  };

  const enrichImages = async (files: File[]) => {
    const { id, created } = await ensureTarget('画像から取り込み中…');
    await api.uploadImages(id, files);
    const comp = await api.composeImages(id, 'rtl');
    await api.analyzeImage(comp.id);
    setPasted([]);
    await onChanged();
    if (created) onSelectPlace(id);
    setMsg(`画像を解析して${selectedPlace ? 'この場所' : '新しい場所'}に追加しました。`);
  };

  const enrichUrl = async (url: string) => {
    const { id, created } = await ensureTarget(hostOf(url));
    await api.crawlPlace(id, { url });
    setQ('');
    await onChanged();
    if (created) onSelectPlace(id);
    setMsg(`URL を要約して${selectedPlace ? 'この場所' : '新しい場所'}に追加しました。`);
  };

  const textSearch = async () => {
    const r = await api.searchPlaces({ q: q.trim() });
    setResults(r);
    setMsg(r.length === 0 ? '該当する施設が見つかりませんでした。' : '');
  };

  const run = async () => {
    setBusy(true); setMsg('');
    try {
      if (pasted.length > 0) await enrichImages(pasted);
      else if (isUrl(q)) await enrichUrl(q.trim());
      else if (q.trim()) await textSearch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '処理に失敗しました');
    } finally { setBusy(false); }
  };

  const addCandidate = async (c: PlaceSearchResult) => {
    try {
      await api.addPlaceToTrip(tripId, {
        name: c.name, address: c.address ?? undefined,
        lat: c.lat ?? undefined, lng: c.lng ?? undefined, category: c.category ?? undefined,
      });
      setResults((prev) => prev.filter((x) => x.place_id !== c.place_id));
      await onChanged();
    } catch (e) { setMsg(e instanceof Error ? e.message : '追加に失敗しました'); }
  };

  const runLabel = pasted.length > 0
    ? (busy ? '解析中…' : `画像を解析 (${pasted.length})`)
    : isUrl(q) ? (busy ? '取り込み中…' : 'URL を取り込む')
    : (busy ? '検索中…' : '検索');

  return (
    <div className="card foundation-form intelligent-search" style={{ marginTop: 10 }}>
      <div className="spread" style={{ alignItems: 'center' }}>
        <strong>🔎 インテリジェント検索</strong>
        <span className="muted" style={{ fontSize: 12 }}>{targetLabel}</span>
      </div>
      <p className="muted" style={{ margin: '2px 0 0' }}>
        キーワードで施設検索、URL や画像を貼り付けると要約・解析して情報を追加します。
      </p>

      <div className="row">
        <input type="search" placeholder="キーワード / URL を入力、画像は貼り付け" value={q}
          onChange={(e) => setQ(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} style={{ flex: 1 }} />
        <button type="button" onClick={() => void run()} disabled={busy || (!q.trim() && pasted.length === 0)}>
          {runLabel}
        </button>
      </div>

      {pasted.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {pasted.map((f, i) => (
            <img key={i} className="thumb" src={URL.createObjectURL(f)} alt={`paste ${i}`}
              style={{ width: 44, aspectRatio: '1 / 1' }} />
          ))}
          <button type="button" className="sm ghost" onClick={() => setPasted([])}>クリア</button>
        </div>
      )}

      {msg && <div className="muted">{msg}</div>}

      {results.length > 0 && (
        <div className="stack">
          {results.map((c) => (
            <div key={c.place_id} className="spread" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
              <div>
                <strong>{c.name}</strong>
                {c.category && <span className="chip" style={{ marginLeft: 6 }}>{c.category}</span>}
                {c.address && <div className="muted">{c.address}</div>}
              </div>
              <button type="button" className="sm ghost" onClick={() => void addCandidate(c)}>追加</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
