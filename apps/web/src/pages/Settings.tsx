import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { getPrefs, setPrefs, USER_NAME_MAX, type Prefs, type StatusFilterPref } from '../lib/prefs.js';
import { getLastTripId } from '../lib/currentTrip.js';
import type { HomeLocation, MapConfig, RouteMode, Trip } from '../types.js';

const STATUS_OPTS: { v: StatusFilterPref; label: string }[] = [
  { v: 'all', label: 'すべて' },
  { v: 'interested', label: '気になる' },
  { v: 'visited', label: '訪問済み' },
];
const MODE_OPTS: { v: RouteMode; label: string }[] = [
  { v: 'driving', label: '車' },
  { v: 'walking', label: '徒歩' },
  { v: 'transit', label: '公共交通' },
  { v: 'bicycling', label: '自転車' },
];

/** 設定 — 地図APIキー状態 / 表示設定 / 旅の管理。 */
export function Settings() {
  const [map, setMap] = useState<MapConfig | null>(null);
  const [mapErr, setMapErr] = useState('');
  const [prefs, setPrefsState] = useState<Prefs>(() => getPrefs());

  // 選択中の旅 (直近に開いた旅) の詳細編集。
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripForm, setTripForm] = useState({ title: '', start_date: '', end_date: '', notes: '' });
  const [tripMsg, setTripMsg] = useState('');
  const [tripErr, setTripErr] = useState('');
  const [tripBusy, setTripBusy] = useState(false);

  // 自宅 (旅の出発地点に使い回す)。
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [homeAddr, setHomeAddr] = useState('');
  const [homeMsg, setHomeMsg] = useState('');
  const [homeErr, setHomeErr] = useState('');
  const [homeBusy, setHomeBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setMap(await api.mapConfig()); }
      catch (e) { setMapErr(e instanceof Error ? e.message : '取得に失敗しました'); }
      try {
        const h = await api.getHome();
        setHome(h);
        setHomeAddr(h?.address ?? '');
      } catch { /* 自宅未設定は無視 */ }
      // 直近に開いた旅があれば、その詳細を編集できるよう読み込む。
      const lastTripId = getLastTripId();
      if (lastTripId) {
        try {
          const detail = await api.getTrip(lastTripId);
          setTrip(detail.trip);
          setTripForm({
            title: detail.trip.title,
            start_date: detail.trip.start_date ?? '',
            end_date: detail.trip.end_date ?? '',
            notes: detail.trip.notes ?? '',
          });
        } catch { /* 旅が消えている等は無視 (未選択扱い) */ }
      }
    })();
  }, []);

  const saveTrip = async () => {
    if (!trip) return;
    const title = tripForm.title.trim();
    if (!title) { setTripErr('タイトルを入力してください'); return; }
    setTripBusy(true); setTripErr(''); setTripMsg('');
    try {
      const updated = await api.patchTrip(trip.id, {
        title,
        start_date: tripForm.start_date || null,
        end_date: tripForm.end_date || null,
        notes: tripForm.notes.trim() || null,
      });
      setTrip(updated);
      setTripMsg('旅の情報を保存しました。');
    } catch (e) {
      setTripErr(e instanceof Error ? e.message : '旅の情報の保存に失敗しました');
    } finally { setTripBusy(false); }
  };

  const saveHome = async () => {
    setHomeBusy(true); setHomeErr(''); setHomeMsg('');
    try {
      const h = await api.setHome({ address: homeAddr.trim() });
      setHome(h); setHomeAddr(h.address);
      setHomeMsg(h.station ? `自宅を保存しました（最寄り駅: ${h.station}）。` : '自宅を保存しました。');
    } catch (e) {
      setHomeErr(e instanceof Error ? e.message : '自宅の保存に失敗しました');
    } finally { setHomeBusy(false); }
  };

  /** 現在地 (Geolocation) から自宅を設定する。最寄り駅はサーバが自動取得する。 */
  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) { setHomeErr('この端末では現在地を取得できません'); return; }
    setHomeBusy(true); setHomeErr(''); setHomeMsg('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const h = await api.setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setHome(h); setHomeAddr(h.address);
          setHomeMsg(h.station ? `現在地から自宅を設定しました（最寄り駅: ${h.station}）。` : '現在地から自宅を設定しました。');
        } catch (e) {
          setHomeErr(e instanceof Error ? e.message : '現在地からの設定に失敗しました');
        } finally { setHomeBusy(false); }
      },
      (err) => {
        setHomeBusy(false);
        setHomeErr(err.code === err.PERMISSION_DENIED
          ? '位置情報の利用が許可されていません（ブラウザ/OS の設定を確認してください）'
          : '現在地を取得できませんでした');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const removeHome = async () => {
    setHomeBusy(true); setHomeErr(''); setHomeMsg('');
    try {
      await api.deleteHome();
      setHome(null); setHomeAddr('');
      setHomeMsg('自宅を削除しました。');
    } catch (e) {
      setHomeErr(e instanceof Error ? e.message : '自宅の削除に失敗しました');
    } finally { setHomeBusy(false); }
  };

  const update = (patch: Partial<Prefs>) => setPrefsState(setPrefs(patch));

  const resetMenu = () => {
    try { localStorage.removeItem('pe.navmenu'); } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <div className="page-narrow">
      <h2>⚙ 設定</h2>

      {/* 選択中の旅の詳細編集 (直近に開いた旅)。旅未選択なら案内のみ。 */}
      {trip ? (
        <div className="card foundation-form">
          <h3 style={{ marginTop: 0 }}>選択中の旅</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            直近に開いた旅「{trip.title}」の詳細を編集できます。
          </p>
          {tripErr && <div className="error">⚠ {tripErr}</div>}
          {tripMsg && <p className="muted">{tripMsg}</p>}

          <label htmlFor="trip-title">タイトル</label>
          <input id="trip-title" type="text" value={tripForm.title}
            onChange={(e) => setTripForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="旅のタイトル" />

          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 130 }}>
              <span>開始日</span>
              <input type="date" value={tripForm.start_date}
                onChange={(e) => setTripForm((f) => ({ ...f, start_date: e.target.value }))} />
            </label>
            <label style={{ flex: 1, minWidth: 130 }}>
              <span>終了日</span>
              <input type="date" value={tripForm.end_date}
                onChange={(e) => setTripForm((f) => ({ ...f, end_date: e.target.value }))} />
            </label>
          </div>

          <label htmlFor="trip-notes" style={{ marginTop: 12 }}>メモ</label>
          <textarea id="trip-notes" rows={3} value={tripForm.notes}
            onChange={(e) => setTripForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="この旅についてのメモ" />

          <div className="row" style={{ gap: 6, marginTop: 12 }}>
            <button type="button" onClick={() => void saveTrip()} disabled={tripBusy || !tripForm.title.trim()}>
              {tripBusy ? '保存中…' : '旅の情報を保存'}
            </button>
            <Link to={`/trips/${trip.id}`}><button type="button" className="ghost">🗺 この旅を開く</button></Link>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            ※ 日付を変えても旅のしおりの日付は自動では増減しません（しおり側で調整してください）。
          </p>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>選択中の旅</h3>
          <p className="muted">旅を開くと、ここでタイトルや日程を編集できます。</p>
          <Link to="/"><button type="button">🧳 旅一覧を開く</button></Link>
        </div>
      )}

      {/* 地図APIキー状態 */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>地図 API キー</h3>
        {mapErr && <div className="error">⚠ {mapErr}</div>}
        {!map && !mapErr && <p className="muted">確認中…</p>}
        {map && (
          map.enabled && map.apiKey
            ? <p>状態: <span className="chip status-visited">有効</span></p>
            : <p>状態: <span className="chip" style={{ background: '#f3f3f1', color: 'var(--c-muted)' }}>未設定</span>
                <span className="muted">（地図/検索/経路は利用できません）</span></p>
        )}
        <p className="muted" style={{ margin: 0 }}>
          キーはサーバの暗号化 config に格納します（フロントからは変更できません）。
        </p>
      </div>

      {/* 表示設定 */}
      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>表示設定</h3>
        <label htmlFor="pref-status">場所一覧の状態フィルタ既定</label>
        <select id="pref-status" value={prefs.defaultStatusFilter}
          onChange={(e) => update({ defaultStatusFilter: e.target.value as StatusFilterPref })}>
          {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>

        <label htmlFor="pref-mode" style={{ marginTop: 12 }}>しおりの移動手段の既定</label>
        <select id="pref-mode" value={prefs.defaultRouteMode}
          onChange={(e) => update({ defaultRouteMode: e.target.value as RouteMode })}>
          {MODE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>

        <label htmlFor="pref-username" style={{ marginTop: 12 }}>表示名（複数人編集用・最大{USER_NAME_MAX}文字）</label>
        <input id="pref-username" type="text" maxLength={USER_NAME_MAX} value={prefs.userName}
          onChange={(e) => update({ userName: e.target.value })} placeholder="あなたの表示名" />
        <p className="muted" style={{ margin: 0 }}>
          「気になる」や日程の編集に、誰が操作したかを表示します。初回はランダムな名前が割り当てられます。
        </p>

        <button type="button" className="ghost" onClick={resetMenu} style={{ marginTop: 14 }}>
          メニュー位置をリセット
        </button>
        <p className="muted" style={{ margin: 0 }}>PC のインタラクティブメニューを初期位置（右下）へ戻します。</p>
      </div>

      {/* 自宅 (旅の出発地点) */}
      <div className="card foundation-form">
        <h3 style={{ marginTop: 0 }}>自宅</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          旅のしおりで出発地点を「自宅」にすると、ここの住所から初日の往路・最終日の復路を自動算出します。
        </p>
        {homeErr && <div className="error">⚠ {homeErr}</div>}
        {homeMsg && <p className="muted">{homeMsg}</p>}
        {home
          ? <p>登録済み: <strong>{home.address}</strong>{home.station ? <span className="muted">（最寄り駅: {home.station}）</span> : null}</p>
          : <p className="muted">未登録</p>}
        <button type="button" onClick={useCurrentLocation} disabled={homeBusy}>
          {homeBusy ? '取得中…' : '📍 現在地から設定'}
        </button>
        <input type="text" placeholder="または住所を入力" value={homeAddr}
          onChange={(e) => setHomeAddr(e.target.value)} />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="ghost" onClick={() => void saveHome()} disabled={homeBusy || !homeAddr.trim()}>
            {homeBusy ? '保存中…' : '住所で保存'}
          </button>
          {home && (
            <button type="button" className="ghost" onClick={() => void removeHome()} disabled={homeBusy}>削除</button>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>現在地または住所から座標化し、最寄り駅を自動取得します。</p>
      </div>

      {/* 旅の管理 */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>旅の管理</h3>
        <p className="muted">旅の作成・アーカイブ・完全削除は旅一覧から行います。</p>
        <Link to="/"><button type="button">🧳 旅一覧を開く</button></Link>
      </div>
    </div>
  );
}
