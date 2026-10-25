/** Life-event ("imprevisto") kind metadata for the UI. */
import type { LifeEventKind, Severity } from '@/domain/types';
import type { IconName } from '@/ui';

const KIND_ICON: Record<LifeEventKind, IconName> = {
  padel: 'padel',
  football: 'football',
  other_sport: 'other',
  injury: 'bandage',
  illness: 'illness',
  overload: 'bolt',
  work: 'briefcase',
  stress: 'stress',
  travel: 'plane',
  social: 'party',
  exam: 'book',
  other: 'info',
};

export function lifeEventIcon(kind: LifeEventKind): IconName {
  return KIND_ICON[kind];
}

/** Which fields the form shows for a kind. */
export type KindGroup = 'sport' | 'injury' | 'range';

export function kindGroup(kind: LifeEventKind): KindGroup {
  if (kind === 'padel' || kind === 'football' || kind === 'other_sport') return 'sport';
  if (kind === 'injury') return 'injury';
  return 'range';
}

/** Kinds that are point-in-time (date + optional time) rather than a date range. */
export function hasTime(kind: LifeEventKind): boolean {
  return kindGroup(kind) === 'sport' || kind === 'social';
}

export const SEVERITIES: readonly Severity[] = [1, 2, 3];

export function isSeverity(value: unknown): value is Severity {
  return value === 1 || value === 2 || value === 3;
}
