// @implements SPEC-EXPRESS-UI
import { useState } from 'react';
import type { ExpressStation } from '../../types.js';

function parseCoord(text: string, limit: number): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

/**
 * 駅座標の手修正。Geocoding で取れなかった駅 (空欄) を埋める。
 * 便の提案 (乗車駅・降車駅の判定) は座標のある駅しか使わないため、空欄の駅は目立たせる。
 */
export function ExpressStationCoords({
  stations, onSave, busy,
}: {
  stations: ExpressStation[];
  onSave: (seq: number, coords: { lat: number | null; lng: number | null }) => void | Promise<void>;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState<Record<number, { lat: string; lng: string }>>({});
  const [error, setError] = useState('');
  const valueOf = (s: ExpressStation) => draft[s.seq] ?? { lat: s.lat?.toString() ?? '', lng: s.lng?.toString() ?? '' };

  const save = async (s: ExpressStation) => {
    const v = valueOf(s);
    const lat = parseCoord(v.lat, 90);
    const lng = parseCoord(v.lng, 180);
    if (lat === undefined || lng === undefined || (lat === null) !== (lng === null)) {
      setError(`${s.name}: 緯度・経度を数値の組で入れてください (消すときは両方空)`);
      return;
    }
    setError('');
    await onSave(s.seq, { lat, lng });
    setDraft((d) => { const next = { ...d }; delete next[s.seq]; return next; });
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      {error && <div className="error">{error}</div>}
      {stations.map((s) => {
        const v = valueOf(s);
        const dirty = draft[s.seq] !== undefined;
        return (
          <div key={s.seq} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span style={{ minWidth: 84 }}>{s.name}{s.lat == null ? ' ⚠' : ''}</span>
            <input type="text" inputMode="decimal" placeholder="緯度" value={v.lat} style={{ width: 96 }}
              onChange={(e) => setDraft((d) => ({ ...d, [s.seq]: { ...v, lat: e.target.value } }))} />
            <input type="text" inputMode="decimal" placeholder="経度" value={v.lng} style={{ width: 104 }}
              onChange={(e) => setDraft((d) => ({ ...d, [s.seq]: { ...v, lng: e.target.value } }))} />
            {dirty && <button type="button" className="sm" disabled={busy} onClick={() => void save(s)}>保存</button>}
          </div>
        );
      })}
    </div>
  );
}
