/**
 * Race form state ↔ RaceDraft, validated with the domain zod schema (pure).
 */
import { addDays } from '@/domain/dates';
import type { ISODate, Race, RaceDistance, RaceDraft, RacePriority } from '@/domain/types';
import { firstError, raceDraftSchema } from '@/domain/validation';

export interface RaceFormState {
  name: string;
  date: ISODate;
  distance: RaceDistance;
  priority: RacePriority;
  location: string;
  goal: string;
  notes: string;
}

/** Default date for a new race: ~3 months out. */
const DEFAULT_LEAD_DAYS = 90;

export function initialRaceForm(race: Race | null, today: ISODate): RaceFormState {
  if (!race) {
    return {
      name: '',
      date: addDays(today, DEFAULT_LEAD_DAYS),
      distance: 'olympic',
      priority: 'B',
      location: '',
      goal: '',
      notes: '',
    };
  }
  return {
    name: race.name,
    date: race.date,
    distance: race.distance,
    priority: race.priority,
    location: race.location ?? '',
    goal: race.goal ?? '',
    notes: race.notes ?? '',
  };
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toRaceDraft(state: RaceFormState): RaceDraft {
  return {
    name: state.name.trim(),
    date: state.date.trim(),
    distance: state.distance,
    priority: state.priority,
    location: orNull(state.location),
    goal: orNull(state.goal),
    notes: orNull(state.notes),
  };
}

export type RaceValidation = { ok: true; draft: RaceDraft } | { ok: false; error: string };

export function validateRaceForm(state: RaceFormState): RaceValidation {
  const draft = toRaceDraft(state);
  const result = raceDraftSchema.safeParse(draft);
  if (!result.success) return { ok: false, error: firstError(result) ?? 'Revisa los datos de la carrera.' };
  return { ok: true, draft };
}
