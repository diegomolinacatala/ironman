/**
 * Race form state ↔ RaceDraft, validated with the domain zod schema (pure).
 */
import { addDays } from '@/domain/dates';
import type { ISODate, Race, RaceDistance, RaceDraft, RacePriority } from '@/domain/types';
import { raceDistanceLabel } from '@/domain/labels';
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

/**
 * `isFirstRace`: the athlete has no race yet, so this one is the season goal (A).
 * Afterwards a new race defaults to B.
 */
export function initialRaceForm(race: Race | null, today: ISODate, isFirstRace = false): RaceFormState {
  if (!race) {
    return {
      name: '',
      date: addDays(today, DEFAULT_LEAD_DAYS),
      distance: 'olympic',
      priority: isFirstRace ? 'A' : 'B',
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

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Name when the athlete leaves it empty: "Olímpico de marzo". */
export function defaultRaceName(distance: RaceDistance, date: ISODate): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const label = raceDistanceLabel(distance);
  return month ? `${label} de ${month}` : label;
}

export function toRaceDraft(state: RaceFormState): RaceDraft {
  return {
    name: state.name.trim() || defaultRaceName(state.distance, state.date.trim()),
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

/**
 * Whether saving this draft reshapes the season: a new upcoming race, or a new
 * date, distance or priority. Then the app offers Plan → General.
 */
export function changesSeason(before: Race | null, draft: RaceDraft, today: ISODate): boolean {
  if (draft.date < today) return false;
  if (!before) return true;
  return before.date !== draft.date || before.distance !== draft.distance || before.priority !== draft.priority;
}
