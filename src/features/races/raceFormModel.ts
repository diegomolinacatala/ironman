/**
 * Race form state ↔ RaceDraft, validated with the domain zod schema (pure).
 */
import { addDays } from '@/domain/dates';
import { racePrepOf } from '@/domain/periodization';
import type { ISODate, Race, RaceDistance, RaceDraft, RacePrep, RacePriority } from '@/domain/types';
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
  /** B/C races: how the athlete prepares it; null = not chosen (the priority's default). */
  prep: RacePrep | null;
}

/** «¿Cómo la preparas?» options for a B/C race, with their one-line hint. */
export const PREP_OPTIONS: readonly { value: RacePrep; label: string; hint: string }[] = [
  { value: 'training', label: 'Como entreno', hint: 'Como entreno: sin afinar; como mucho, el día antes suave.' },
  { value: 'taper', label: 'Solo afinar', hint: 'Solo afinar: mini-afinamiento de 3–5 días y unos días suaves después.' },
  {
    value: 'specific',
    // The full name («Preparación específica») does not fit a third of a phone: the hint says it.
    label: 'Específica',
    hint: 'Preparación específica: las 3 semanas antes, más sesiones a su ritmo; tu carrera A sigue mandando.',
  },
];

/** The preparation the form shows: none for an A race, else the choice or the priority's default. */
export function formPrep(state: Pick<RaceFormState, 'priority' | 'prep'>): RacePrep | null {
  return racePrepOf(state);
}

export function prepHint(prep: RacePrep): string {
  return PREP_OPTIONS.find((o) => o.value === prep)?.hint ?? '';
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
      prep: null,
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
    prep: race.prep ?? null,
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
    // A races ignore it: saved as null so a later B/C starts from its default.
    prep: state.priority === 'A' ? null : state.prep,
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
 * date, distance, priority or preparation. Then the app offers Plan → General.
 */
export function changesSeason(before: Race | null, draft: RaceDraft, today: ISODate): boolean {
  if (draft.date < today) return false;
  if (!before) return true;
  return (
    before.date !== draft.date ||
    before.distance !== draft.distance ||
    before.priority !== draft.priority ||
    racePrepOf(before) !== racePrepOf(draft)
  );
}
