import type { PlaceFacility } from '../types.js';

export function groupFacilitiesByPlace(facilities: readonly PlaceFacility[]): Map<string, PlaceFacility[]> {
  const grouped = new Map<string, PlaceFacility[]>();
  for (const facility of facilities) {
    const current = grouped.get(facility.place_id);
    if (current) current.push(facility);
    else grouped.set(facility.place_id, [facility]);
  }
  return grouped;
}

export function wantedFacilityNames(
  grouped: ReadonlyMap<string, readonly PlaceFacility[]>,
  placeId: string,
): string[] {
  return (grouped.get(placeId) ?? [])
    .filter((facility) => facility.wanted === 1)
    .map((facility) => facility.name);
}
