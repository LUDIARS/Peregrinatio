// @implements SPEC-ACCESS-SETTINGS
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { AccessMarkSettings } from '../../types.js';

/**
 * 設定ページの「タクシー初乗り距離」。🚕 初乗り圏の印はこの距離で判定する
 * (地域ごとの運賃表は持たないので、旅先に合わせてここで変える)。
 */
export function AccessMarkSettingsCard() {
  const [settings, setSettings] = useState<AccessMarkSettings | null>(null);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAccessMarkSettings()
      .then((s) => { setSettings(s); setValue(String(s.taxi_first_fare_m)); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '設定を読めませんでした'));
  }, []);

  const apply = async (next: Promise<AccessMarkSettings>, done: string) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const s = await next;
      setSettings((cur) => ({ ...cur, ...s }));
      setValue(String(s.taxi_first_fare_m));
      setMsg(done);
    } catch (e) { setErr(e instanceof Error ? e.message : '保存できませんでした'); }
    finally { setBusy(false); }
  };

  const n = Number(value);
  return (
    <div className="card foundation-form">
      <h3 style={{ marginTop: 0 }}>タクシー初乗り距離</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        場所の 🚕 初乗り圏の印は、拠点または最寄り駅からの道のりがこの距離以内かで決まります
        (道のり = 直線距離 × 車の迂回係数)。既定は {settings?.default_taxi_first_fare_m ?? 1200}m。
      </p>
      {err && <div className="error">⚠ {err}</div>}
      {msg && <p className="muted">{msg}</p>}
      <div className="row" style={{ gap: 6 }}>
        <input type="number" min={settings?.min ?? 300} max={settings?.max ?? 10000} step={100} value={value}
          onChange={(e) => setValue(e.target.value)} style={{ width: 120 }} aria-label="タクシー初乗り距離 (m)" />
        <span>m</span>
        <button type="button" disabled={busy || !Number.isInteger(n)}
          onClick={() => void apply(api.setAccessMarkSettings(n), '保存しました。')}>保存</button>
        {settings && !settings.is_default && (
          <button type="button" className="ghost" disabled={busy}
            onClick={() => void apply(api.resetAccessMarkSettings(), '既定に戻しました。')}>既定に戻す</button>
        )}
      </div>
    </div>
  );
}
