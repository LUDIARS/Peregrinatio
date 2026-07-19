import type { PlaceFacility } from '../../types.js';

interface Props {
  facilities: PlaceFacility[];
  busy: boolean;
  message: string;
  onToggle: (facility: PlaceFacility, wanted: boolean) => void;
  onSuggest: () => void;
}

export function FacilityChecklist({ facilities, busy, message, onToggle, onSuggest }: Props) {
  return (
    <div className="facility-checklist">
      {facilities.length > 0 ? facilities.map((facility) => (
        <label key={facility.id} className="facility-check">
          <input
            type="checkbox"
            checked={facility.wanted === 1}
            disabled={busy}
            onChange={(event) => onToggle(facility, event.target.checked)}
          />
          <span>{facility.name}</span>
        </label>
      )) : <p className="muted">設備候補はまだありません。</p>}
      <button type="button" className="sm ghost" disabled={busy} onClick={onSuggest}>
        {busy ? 'Haikuで確認中…' : 'Haikuで設備を提案'}
      </button>
      {message && <div className="muted facility-message">{message}</div>}
    </div>
  );
}
