import type { Placement } from '../db/schema';

export function placementLabel(type: Placement['type']): string {
  switch (type) {
    case 'initials':
      return 'Initials';
    case 'date':
      return 'Date';
    case 'text':
      return 'Text';
    default:
      return 'Signature';
  }
}

/** Label plus a short preview of the value for text placements. */
export function placementSummary(placement: Placement): string {
  const label = placementLabel(placement.type);
  if (placement.type !== 'text' || !placement.value?.trim()) {
    return label;
  }
  const value = placement.value.trim();
  return `${label} — ${value.length > 24 ? `${value.slice(0, 24)}…` : value}`;
}
