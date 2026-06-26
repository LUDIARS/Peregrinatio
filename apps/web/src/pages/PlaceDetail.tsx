import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.js';
import type { PlaceLink, PlaceStatus, TripPlace } from '../types.js';

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
  onChanged?: () => void;
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
  const [error, setError] = useState('');

  const loadPlace = async () => {
    const detail = await api.getTrip(tripId);
    const p = detail.places.find((x) => x.id === placeId) ?? null;
    if (!p) { setError('この場所が見つかりません'); return; }
    setPlace(p);
  };
  const loadLinks = async () => { setLinks(await api.listLinks(placeId)); };

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadPlace(), loadLinks()]); }
      catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, placeId]);

  const setStatus = async (status: PlaceStatus) => {
    try {
      const p = await api.patchPlace(placeId, { status });
      setPlace((prev) => (prev ? { ...prev, ...p } : null)); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'ステータス更新に失敗しました'); }
  };

  const toggleBase = async () => {
    if (!place) return;
    try {
      const p = await api.setTripBase(tripId, placeId, place.is_base === 1 ? 0 : 1);
      setPlace((prev) => (prev ? { ...prev, ...p } : p)); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : '拠点の更新に失敗しました'); }
  };

  const removeFromTrip = async () => {
    if (!place) return;
    if (!window.confirm(`「${place.name}」をこの旅から外しますか? (場所ライブラリには残ります)`)) return;
    try { await api.removeFromTrip(tripId, placeId); onChanged?.(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '除外に失敗しました'); }
  };

  const remove = async () => {
    if (!window.confirm('この場所をライブラリから完全に削除しますか?')) return;
    try { await api.deletePlace(placeId); onChanged?.(); onClose(); }
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
              ? <img className="place-hero-img" src={assetUrl(place.image_url)} alt={place.name} />
              : <div className="place-hero-img placeholder">画像なし</div>}
            <h2 className="place-hero-name">{place.is_base === 1 ? '🏨 ' : ''}{place.name}</h2>
            {place.address && <div className="place-hero-addr">{place.address}</div>}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {place.category && <span className="chip">{place.category}</span>}
              {place.lat != null && place.lng != null
                ? <span className="chip">📍 {place.lat.toFixed(4)}, {place.lng.toFixed(4)}</span>
                : <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>位置なし</span>}
            </div>
          </div>

          {/* 説明 (サマリー) */}
          <div className="place-section">
            <h3 className="place-section-title">説明</h3>
            {place.summary
              ? <p className="place-hero-summary">{place.summary}</p>
              : <p className="muted">まだ説明がありません。中央のインテリジェント検索に URL や画像を貼り付けると生成できます。</p>}
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

          {/* ここに行く: 旅のしおり (カンバン) を開き、どの日程に入れるか選ぶ。 */}
          <button type="button" className="goto-btn"
            onClick={() => navigate(`/trips/${tripId}/itinerary?place=${encodeURIComponent(placeId)}`)}>
            🗓 ここに行く（日程に追加）
          </button>

          {/* 管理ツールバー (状態 / 拠点 / 外す / 削除) */}
          <div className="place-toolbar">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="muted" style={{ alignSelf: 'center' }}>状態:</span>
              {STATUS_OPTIONS.map((o) => (
                <button key={o.key} type="button"
                  className={place.status === o.key ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => void setStatus(o.key)}>{o.label}</button>
              ))}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button type="button" className="sm ghost" onClick={() => void toggleBase()}>
                {place.is_base === 1 ? '拠点解除' : '拠点にする'}
              </button>
              <button type="button" className="sm ghost" onClick={() => void removeFromTrip()}>この旅から外す</button>
              <button type="button" className="sm danger" onClick={() => void remove()}>削除</button>
            </div>
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
