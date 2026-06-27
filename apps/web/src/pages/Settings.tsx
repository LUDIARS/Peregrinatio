import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { getPrefs, setPrefs, type Prefs, type StatusFilterPref } from '../lib/prefs.js';
import type { MapConfig, RouteMode } from '../types.js';

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

  useEffect(() => {
    (async () => {
      try { setMap(await api.mapConfig()); }
      catch (e) { setMapErr(e instanceof Error ? e.message : '取得に失敗しました'); }
    })();
  }, []);

  const update = (patch: Partial<Prefs>) => setPrefsState(setPrefs(patch));

  const resetMenu = () => {
    try { localStorage.removeItem('pe.navmenu'); } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <div className="page-narrow">
      <h2>⚙ 設定</h2>

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

        <button type="button" className="ghost" onClick={resetMenu} style={{ marginTop: 14 }}>
          メニュー位置をリセット
        </button>
        <p className="muted" style={{ margin: 0 }}>PC のインタラクティブメニューを初期位置（右下）へ戻します。</p>
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
