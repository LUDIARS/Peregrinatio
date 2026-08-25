import { useEffect, useState } from 'react';
import type { RouteLeg, RouteMode, TransitKind } from '../../types.js';

export interface FixedRouteDraft {
  mode: RouteMode;
  transit_kind: TransitKind | null;
  depart_time: string | null;
  arrive_time: string | null;
  note: string | null;
  is_fixed: boolean;
}

interface FixedRouteEditorProps {
  leg: RouteLeg;
  fromLabel: string;
  toLabel: string;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: FixedRouteDraft) => Promise<void>;
}

const MODES: Array<{ value: RouteMode; label: string }> = [
  { value: 'driving', label: '車' },
  { value: 'walking', label: '徒歩' },
  { value: 'transit', label: '公共交通' },
  { value: 'bicycling', label: '自転車' },
];

export const TRANSIT_KIND_LABEL: Record<TransitKind, string> = {
  shinkansen: '新幹線',
  train: '電車',
  bus: 'バス',
  airplane: '飛行機',
  taxi: 'タクシー',
};

const TRANSIT_KINDS = Object.entries(TRANSIT_KIND_LABEL) as Array<[TransitKind, string]>;

/** @implements SPEC-FIXED-ROUTE-SAVE — edit one reorder-resistant, manually confirmed segment. */
export function FixedRouteEditor({
  leg,
  fromLabel,
  toLabel,
  saving,
  onClose,
  onSave,
}: FixedRouteEditorProps) {
  const [mode, setMode] = useState<RouteMode>(leg.mode);
  const [transitKind, setTransitKind] = useState<TransitKind>(leg.transit_kind ?? 'train');
  const [departTime, setDepartTime] = useState(leg.depart_time ?? '');
  const [arriveTime, setArriveTime] = useState(leg.arrive_time ?? '');
  const [note, setNote] = useState(leg.note ?? '');

  useEffect(() => {
    setMode(leg.mode);
    setTransitKind(leg.transit_kind ?? 'train');
    setDepartTime(leg.depart_time ?? '');
    setArriveTime(leg.arrive_time ?? '');
    setNote(leg.note ?? '');
  }, [leg]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSave({
      mode,
      transit_kind: mode === 'transit' ? transitKind : null,
      depart_time: departTime || null,
      arrive_time: arriveTime || null,
      note: note.trim() || null,
      is_fixed: true,
    });
  };

  const clearFixed = async () => {
    await onSave({
      mode: leg.mode,
      transit_kind: leg.transit_kind,
      depart_time: leg.depart_time,
      arrive_time: leg.arrive_time,
      note: leg.note,
      is_fixed: false,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal fixed-route-editor" onSubmit={(event) => void submit(event)} onClick={(event) => event.stopPropagation()}>
        <div className="spread">
          <strong>✅ 移動経路の確定情報</strong>
          <button type="button" className="sm ghost" onClick={onClose}>閉じる</button>
        </div>
        <p className="muted fixed-route-endpoints">{fromLabel} → {toLabel}</p>

        <label>
          <span>移動手段</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as RouteMode)}>
            {MODES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>

        {mode === 'transit' && (
          <label>
            <span>公共交通の種類</span>
            <select value={transitKind} onChange={(event) => setTransitKind(event.target.value as TransitKind)}>
              {TRANSIT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        )}

        <div className="fixed-route-times">
          <label><span>出発時刻</span><input type="time" value={departTime} onChange={(event) => setDepartTime(event.target.value)} /></label>
          <label><span>到着時刻</span><input type="time" value={arriveTime} onChange={(event) => setArriveTime(event.target.value)} /></label>
        </div>

        <label>
          <span>メモ（URLも貼れます）</span>
          <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="予約ページや時刻表のURL、便名、乗り場など" />
        </label>

        <div className="fixed-route-actions">
          {leg.is_fixed === 1 && <button type="button" className="sm ghost" onClick={() => void clearFixed()} disabled={saving}>確定を解除</button>}
          <button type="submit" className="sm" disabled={saving}>{saving ? '保存中…' : '確定情報を保存'}</button>
        </div>
      </form>
    </div>
  );
}
