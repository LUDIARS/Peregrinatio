import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import type { PlaceImage, PlaceLink, PlaceStatus, TripPlace } from '../types.js';

const STATUS_OPTIONS: { key: PlaceStatus; label: string }[] = [
  { key: 'interested', label: '気になる' },
  { key: 'visited', label: '訪問済み' },
  { key: 'none', label: '通常' },
];

interface PaneProps {
  tripId: string;
  placeId: string;
  onClose: () => void;
  /** place/list に影響する変更後 (ステータス/拠点/外す/削除) に呼ぶ。 */
  onChanged?: () => void | Promise<void>;
}

/**
 * 場所詳細ペーン (PC=右カラム / モバイル=ポップアップ / ルート=全画面 で共用)。
 * 「画像 → 説明 → 情報元」の順で情報のみを表示する (名前/住所はデータ由来で編集不可)。
 * 情報の追加 (URL クロール / 画像解析 / 代表画像取得) は中央のインテリジェント検索で行う。
 */
export function PlaceDetailPane({ tripId, placeId, onClose, onChanged }: PaneProps) {
  const navigate = useNavigate();
  const [place, setPlace] = useState<TripPlace | null>(null);
  const [links, setLinks] = useState<PlaceLink[]>([]);
  const [images, setImages] = useState<PlaceImage[]>([]);
  const [error, setError] = useState('');
  const [hotelBusy, setHotelBusy] = useState(false);
  const [hotelMsg, setHotelMsg] = useState('');
  const [memoText, setMemoText] = useState('');
  const [memoBusy, setMemoBusy] = useState(false);
  const [memoMsg, setMemoMsg] = useState('');
  // 自動検索 (情報の無い場所を Google で補完)。
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');
  const [locOpen, setLocOpen] = useState(false);
  const [locAddress, setLocAddress] = useState('');
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locGeocodeBusy, setLocGeocodeBusy] = useState(false);
  const [locMsg, setLocMsg] = useState('');
  // 画像のライトボックス (ページ内オーバーレイ)。
  // 旧実装は <a target="_blank"> でナビゲートしていたが、PWA の SW navigation fallback が
  // index.html を返し ルータ * → / リダイレクトでトップへ飛ぶ不具合があったため、遷移せず
  // ページ内で開く。
  const [lightbox, setLightbox] = useState<string | null>(null);

  const loadPlace = async (syncMemo = true): Promise<TripPlace | null> => {
    const detail = await api.getTrip(tripId);
    const p = detail.places.find((x) => x.id === placeId) ?? null;
    if (!p) { setError('この場所が見つかりません'); return null; }
    setPlace(p);
    if (syncMemo) setMemoText(p.notes ?? '');
    return p;
  };
  const loadLinks = async () => { setLinks(await api.listLinks(placeId)); };
  // 取り込んだ画像 (Kindle 連番などの連結 composite + 元画像 source)。
  const loadImages = async () => { setImages(await api.listImages(placeId)); };

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadPlace(), loadLinks(), loadImages()]); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, placeId]);

  const setStatus = async (status: PlaceStatus) => {
    try {
      const p = await api.patchPlace(placeId, { status });
      setPlace((prev) => (prev ? { ...prev, ...p } : null)); await onChanged?.(); await loadPlace(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'ステータス更新に失敗しました'); }
  };

  const toggleBase = async () => {
    if (!place) return;
    try {
      const p = await api.setTripBase(tripId, placeId, place.is_base === 1 ? 0 : 1);
      setPlace((prev) => (prev ? { ...prev, ...p } : p)); await onChanged?.(); await loadPlace(false);
    } catch (e) { setError(e instanceof Error ? e.message : '拠点の更新に失敗しました'); }
  };

  /** 「また今度」(旅ごと) のトグル。場所リストから隔離 / 復帰。 */
  const togglePostpone = async () => {
    if (!place) return;
    try {
      const p = await api.setPostponed(tripId, placeId, place.postponed !== 1);
      setPlace((prev) => (prev ? { ...prev, ...p } : p)); await onChanged?.(); await loadPlace(false);
    } catch (e) { setError(e instanceof Error ? e.message : '「また今度」の更新に失敗しました'); }
  };

  /** 拠点ホテルの IN/OUT 時刻を手動保存 (後から調整可)。 */
  const saveHotelTime = async (field: 'checkin_time' | 'checkout_time', value: string) => {
    try {
      const p = await api.patchTripPlace(tripId, placeId, { [field]: value || null });
      setPlace((prev) => (prev ? { ...prev, ...p } : p)); await onChanged?.(); await loadPlace(false);
    } catch (e) { setHotelMsg(e instanceof Error ? e.message : '時刻の保存に失敗しました'); }
  };

  /** 拠点ホテルの IN/OUT 時刻を自動取得 (クロール→LLM)。 */
  const autoFetchHotelTimes = async () => {
    setHotelBusy(true); setHotelMsg('');
    try {
      const p = await api.fetchHotelTimes(tripId, placeId);
      setPlace((prev) => (prev ? { ...prev, ...p } : p)); await onChanged?.(); await loadPlace(false);
      setHotelMsg('チェックイン/アウト時刻を取得しました。必要なら調整してください。');
    } catch (e) {
      setHotelMsg(e instanceof Error ? e.message : '自動取得に失敗しました（手入力で設定してください）');
    } finally { setHotelBusy(false); }
  };

  /** 自動検索: 情報の無い場所を Google で補完し、公式サイトの要約を取り込みキューに積む。 */
  const autoSearch = async () => {
    setAutoBusy(true); setAutoMsg(''); setError('');
    try {
      const r = await api.autoSearchPlace(tripId, placeId);
      setPlace((prev) => (prev ? { ...prev, ...r.place } : r.place));
      await Promise.all([loadLinks(), loadImages()]);
      if (!r.matched) {
        setAutoMsg('公式情報が見つかりませんでした。URL や画像から追加してください。');
      } else if (r.queuedCrawl) {
        setAutoMsg('公式情報を取り込みました。説明（要約）は取り込みキューで順次反映されます。');
      } else {
        setAutoMsg('公式情報を取り込みました。');
      }
      await onChanged?.();
      await loadPlace(false);
    } catch (e) {
      setAutoMsg(e instanceof Error ? e.message : '自動検索に失敗しました');
    } finally { setAutoBusy(false); }
  };

  const saveMemo = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemoBusy(true); setMemoMsg(''); setError('');
    try {
      const p = await api.patchPlace(placeId, { notes: memoText.trim() || null });
      setPlace((prev) => (prev ? { ...prev, ...p } : null));
      setMemoText(p.notes ?? '');
      setMemoMsg('メモを保存しました。');
      await onChanged?.();
    } catch (err) {
      setMemoMsg(err instanceof Error ? err.message : 'メモの保存に失敗しました');
    } finally {
      setMemoBusy(false);
    }
  };

  const openLocationEditor = () => {
    if (!place) return;
    setLocAddress(place.address ?? '');
    setLocLat(place.lat == null ? '' : String(place.lat));
    setLocLng(place.lng == null ? '' : String(place.lng));
    setLocMsg('');
    setLocOpen((v) => !v);
  };

  const saveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const latText = locLat.trim();
    const lngText = locLng.trim();
    const hasLatLng = latText !== '' || lngText !== '';
    if (!hasLatLng) {
      if (locAddress.trim()) {
        await geocodeLocation();
      } else {
        setLocMsg('住所、または緯度と経度を入力してください。');
      }
      return;
    }
    if (!latText || !lngText) {
      setLocMsg('緯度と経度は両方入力してください。');
      return;
    }
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocMsg('緯度と経度は数値で入力してください。');
      return;
    }
    setLocBusy(true); setLocMsg(''); setError('');
    try {
      const p = await api.patchPlace(placeId, {
        address: locAddress.trim() || null,
        lat,
        lng,
      });
      setPlace((prev) => (prev ? { ...prev, ...p } : null));
      setLocMsg('位置を更新しました。');
      await onChanged?.();
      await loadPlace(false);
    } catch (err) {
      setLocMsg(err instanceof Error ? err.message : '位置の更新に失敗しました');
    } finally {
      setLocBusy(false);
    }
  };

  const geocodeLocation = async () => {
    const address = locAddress.trim();
    if (!address) {
      setLocMsg('住所を入力してください。');
      return;
    }
    setLocGeocodeBusy(true); setLocMsg(''); setError('');
    try {
      const p = await api.geocodePlace(placeId, { address });
      setPlace((prev) => (prev ? { ...prev, ...p } : null));
      setLocAddress(p.address ?? address);
      setLocLat(p.lat == null ? '' : String(p.lat));
      setLocLng(p.lng == null ? '' : String(p.lng));
      setLocMsg('住所から緯度経度を取得しました。');
      await onChanged?.();
      const fresh = await loadPlace(false);
      if (fresh) {
        setLocAddress(fresh.address ?? address);
        setLocLat(fresh.lat == null ? '' : String(fresh.lat));
        setLocLng(fresh.lng == null ? '' : String(fresh.lng));
      }
    } catch (err) {
      setLocMsg(err instanceof Error ? err.message : '住所から緯度経度を取得できませんでした');
    } finally {
      setLocGeocodeBusy(false);
    }
  };

  const removeFromTrip = async () => {
    if (!place) return;
    if (!window.confirm(`「${place.name}」をこの旅から外しますか? (場所ライブラリには残ります)`)) return;
    try { await api.removeFromTrip(tripId, placeId); await onChanged?.(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '除外に失敗しました'); }
  };

  const remove = async () => {
    if (!window.confirm('この場所をライブラリから完全に削除しますか?')) return;
    try { await api.deletePlace(placeId); await onChanged?.(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '削除に失敗しました'); }
  };

  return (
    <div className="detail-pane">
      <div className="detail-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる" style={{ marginLeft: 'auto' }}>✕</button>
      </div>

      {error && !place && <div className="card error">⚠ {error}</div>}
      {place && (
        <div className="detail-body">
          {/* 画像 → 説明 → 情報元。名前/住所はデータ由来のため編集不可 (表示のみ)。 */}
          <div className="place-hero">
            {place.image_url
              ? <img className="place-hero-img" src={assetUrl(place.image_url)} alt={place.name}
                  role="button" tabIndex={0}
                  onClick={() => setLightbox(assetUrl(place.image_url!))} />
              : <div className="place-hero-img placeholder">画像なし</div>}
            <h2 className="place-hero-name">{place.is_base === 1 ? '🏨 ' : ''}{place.name}</h2>
            {place.address && <div className="place-hero-addr">{place.address}</div>}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {place.category && <span className="chip">{place.category}</span>}
              {place.lat != null && place.lng != null
                ? <span className="chip">📍 {place.lat.toFixed(4)}, {place.lng.toFixed(4)}</span>
                : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
              <button type="button" className="sm ghost" onClick={openLocationEditor}>
                位置を補正する
              </button>
            </div>
            {locOpen && (
              <form className="location-corrector foundation-form" onSubmit={saveLocation}>
                <label>
                  <span className="muted" style={{ fontSize: 12 }}>住所</span>
                  <input type="text" value={locAddress} onChange={(e) => setLocAddress(e.target.value)} />
                </label>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ flex: 1, minWidth: 120 }}>
                    <span className="muted" style={{ fontSize: 12 }}>緯度</span>
                    <input type="number" step="any" value={locLat} onChange={(e) => setLocLat(e.target.value)} />
                  </label>
                  <label style={{ flex: 1, minWidth: 120 }}>
                    <span className="muted" style={{ fontSize: 12 }}>経度</span>
                    <input type="number" step="any" value={locLng} onChange={(e) => setLocLng(e.target.value)} />
                  </label>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="sm ghost" disabled={locGeocodeBusy} onClick={() => void geocodeLocation()}>
                    {locGeocodeBusy ? '取得中…' : '住所から取得'}
                  </button>
                  <button type="submit" className="sm" disabled={locBusy}>
                    {locBusy ? '保存中…' : '位置を保存'}
                  </button>
                  <button type="button" className="sm ghost" onClick={() => setLocOpen(false)}>閉じる</button>
                </div>
                {locMsg && <div className="muted">{locMsg}</div>}
              </form>
            )}
          </div>

          {/* 説明 (サマリー) */}
          <div className="place-section">
            <h3 className="place-section-title">説明</h3>
            {place.summary
              ? <p className="place-hero-summary">{place.summary}</p>
              : <p className="muted">まだ説明がありません。下の「自動検索」で公式情報を取り込むか、URL/画像から追加できます。</p>}

            {/* 自動検索: 情報が無いときに Google で公式情報を取り込む。 */}
            {(!place.summary || !place.source_url) && (
              <button type="button" className="sm" style={{ marginTop: 8 }}
                onClick={() => void autoSearch()} disabled={autoBusy}>
                {autoBusy ? '🔍 自動検索中…' : '🔍 自動検索で公式情報を取り込む'}
              </button>
            )}
            {autoMsg && <div className="muted" style={{ marginTop: 4 }}>{autoMsg}</div>}
          </div>

          <div className="place-section">
            <h3 className="place-section-title">メモ</h3>
            <form className="foundation-form" onSubmit={saveMemo}>
              <textarea
                rows={4}
                value={memoText}
                onChange={(e) => {
                  setMemoText(e.target.value);
                  if (memoMsg) setMemoMsg('');
                }}
                placeholder="営業時間の注意、予約番号、現地で確認したいことなど"
              />
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="submit" className="sm" disabled={memoBusy || memoText === (place.notes ?? '')}>
                  {memoBusy ? '保存中…' : 'メモを保存'}
                </button>
                {memoMsg && <span className="muted">{memoMsg}</span>}
              </div>
            </form>
          </div>

          {/* 情報元 (出典 URL / 資料リンク) */}
          <div className="place-section">
            <h3 className="place-section-title">情報元</h3>
            {place.source_url && (
              <a className="place-source" href={place.source_url} target="_blank" rel="noreferrer">
                {place.source_url}
              </a>
            )}
            {links.length > 0 && (
              <div className="stack" style={{ marginTop: 6 }}>
                {links.map((lk) => (
                  <a key={lk.id} className="place-source" href={lk.url} target="_blank" rel="noreferrer">
                    {lk.title || lk.url}
                  </a>
                ))}
              </div>
            )}
            {!place.source_url && links.length === 0 && (
              <p className="muted">情報元はまだありません。</p>
            )}
          </div>

          {/* 取り込んだ画像 (連結 composite を先頭に、元画像 source を続けて表示)。 */}
          {images.length > 0 && (
            <div className="place-section">
              <h3 className="place-section-title">取り込んだ画像</h3>
              <div className="place-images">
                {[...images]
                  .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'composite' ? -1 : 1))
                  .map((img) => (
                    <button key={img.id} type="button" className="place-image-thumb-btn"
                      onClick={() => setLightbox(assetUrl(img.path))}>
                      <img className="place-image-thumb" src={assetUrl(img.path)}
                        alt={img.kind === 'composite' ? '連結画像' : '取り込み画像'} />
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* 拠点ホテル: チェックイン/チェックアウト (自動取得 + 手動調整)。 */}
          {place.is_base === 1 && (
            <div className="place-section">
              <h3 className="place-section-title">🏨 チェックイン / チェックアウト</h3>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 120 }}>
                  <span className="muted" style={{ fontSize: 12 }}>チェックイン</span>
                  <input type="time" value={place.checkin_time ?? ''}
                    onChange={(e) => void saveHotelTime('checkin_time', e.target.value)} />
                </label>
                <label style={{ flex: 1, minWidth: 120 }}>
                  <span className="muted" style={{ fontSize: 12 }}>チェックアウト</span>
                  <input type="time" value={place.checkout_time ?? ''}
                    onChange={(e) => void saveHotelTime('checkout_time', e.target.value)} />
                </label>
              </div>
              <button type="button" className="sm ghost" style={{ marginTop: 8 }}
                onClick={() => void autoFetchHotelTimes()} disabled={hotelBusy}>
                {hotelBusy ? '取得中…' : '🔄 公式サイトから自動取得'}
              </button>
              {hotelMsg && <div className="muted" style={{ marginTop: 4 }}>{hotelMsg}</div>}
            </div>
          )}

          {/* 情報を追加: この場所に URL/画像から情報を足す。 */}
          <button type="button" className="add-info-btn"
            onClick={() => navigate(`/trips/${tripId}/places/${placeId}/add`)}>
            ➕ 情報を追加（URL / 画像）
          </button>

          {/* ここに行く: 旅のしおり (カンバン) を開き、どの日程に入れるか選ぶ。 */}
          <button type="button" className="goto-btn"
            onClick={() => navigate(`/trips/${tripId}/itinerary?place=${encodeURIComponent(placeId)}`)}>
            🗓 ここに行く（日程に追加）
          </button>

          {/* 管理メニュー (状態 / 拠点)。状態は大きめボタンで目立たせ、破壊的操作は折りたたみで誤爆防止。 */}
          <div className="place-menu">
            <div className="place-menu-label">状態</div>
            <div className="status-btns">
              {STATUS_OPTIONS.map((o) => (
                <button key={o.key} type="button"
                  className={`status-btn${place.status === o.key ? ' active' : ''}`}
                  onClick={() => void setStatus(o.key)}>{o.label}</button>
              ))}
              {/* また今度 (旅ごとの隔離トグル)。状態とは独立だが同じメニューに並べる。 */}
              <button type="button"
                className={`status-btn postpone${place.postponed === 1 ? ' active' : ''}`}
                onClick={() => void togglePostpone()}>🕓 また今度</button>
            </div>

            {/* 拠点の設定は地図側の「拠点を追加」ピッカーで行う。詳細では解除のみ可能にする。 */}
            {place.is_base === 1 && (
              <>
                <div className="place-menu-label" style={{ marginTop: 12 }}>拠点</div>
                <button type="button" className="base-toggle-btn active"
                  onClick={() => void toggleBase()}>
                  🏨 拠点を解除する
                </button>
              </>
            )}

            {/* 破壊的操作は折りたたみの中に入れて誤爆を防ぐ。 */}
            <details className="place-menu-danger">
              <summary>その他の操作</summary>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="sm ghost" onClick={() => void removeFromTrip()}>この旅から外す</button>
                <button type="button" className="sm danger" onClick={() => void remove()}>ライブラリから削除</button>
              </div>
            </details>
          </div>

          {error && <div className="card error">⚠ {error}</div>}
        </div>
      )}

      {lightbox && (
        <div className="image-lightbox" role="dialog" aria-modal="true"
          onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
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
