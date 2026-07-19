import type { PlaceFacility } from '../../types.js';

interface InlineFacilityChoicesProps {
  facilities: readonly PlaceFacility[];
  busyFacilityId: string | null;
  onToggle: (facility: PlaceFacility, wanted: boolean) => void;
}

export function InlineFacilityChoices({
  facilities,
  busyFacilityId,
  onToggle,
}: InlineFacilityChoicesProps) {
  if (facilities.length === 0) return null;

  return (
    <fieldset className="kanban-facilities">
      <legend>設備・やりたいこと</legend>
      <div className="kanban-facility-list">
        {facilities.map((facility) => (
          <label className="kanban-facility-choice" key={facility.id}>
            <input
              type="checkbox"
              checked={facility.wanted === 1}
              disabled={busyFacilityId !== null}
              onChange={(event) => onToggle(facility, event.target.checked)}
            />
            <span>{facility.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
