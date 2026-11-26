/**
 * "Tu objetivo" step (pure): next race (or none yet) and sports. Prefilled from
 * the existing profile and the next upcoming race. No weekly hours: the
 * availability is automatic (the planner fills the calendar's free time).
 */
import type {
  ISODate,
  Profile,
  ProfilePatch,
  Race,
  RaceDistance,
  RaceDraft,
  TrainableSport,
  UUID,
} from '@/domain/types';
import { firstError, raceDraftSchema } from '@/domain/validation';

export const DEFAULT_SPORTS: readonly TrainableSport[] = ['swim', 'bike', 'run'];

export interface GoalRaceInput {
  name: string;
  /** '' until picked. */
  date: ISODate | '';
  distance: RaceDistance;
}

export interface GoalInput {
  hasRace: boolean;
  race: GoalRaceInput;
  /** The existing race being edited (prefilled), null for a new one. */
  raceId: UUID | null;
  sports: TrainableSport[];
}

const EMPTY_RACE: GoalRaceInput = { name: '', date: '', distance: 'olympic' };

/** Next upcoming race: priority A first, then the earliest. */
export function nextRace(races: readonly Race[], today: ISODate): Race | null {
  const upcoming = races.filter((r) => r.date >= today);
  const sorted = [...upcoming].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'A' ? -1 : b.priority === 'A' ? 1 : 0;
    return a.date.localeCompare(b.date);
  });
  return sorted[0] ?? null;
}

export function initialGoal(profile: Profile | null | undefined, races: readonly Race[], today: ISODate): GoalInput {
  const race = nextRace(races, today);
  return {
    hasRace: race != null,
    race: race ? { name: race.name, date: race.date, distance: race.distance } : EMPTY_RACE,
    raceId: race?.id ?? null,
    sports: profile?.sports?.length ? [...profile.sports] : [...DEFAULT_SPORTS],
  };
}

/** Spanish error for the step, or null when it can be saved. */
export function goalError(goal: GoalInput, today: ISODate): string | null {
  if (goal.sports.length === 0) return 'Elige al menos un deporte';
  if (!goal.hasRace) return null;
  if (!goal.race.name.trim()) return 'Ponle un nombre a la carrera';
  if (!goal.race.date) return 'Elige la fecha de la carrera';
  if (goal.race.date < today) return 'Esa fecha ya ha pasado';
  const draft = goalRaceDraft(goal);
  const result = raceDraftSchema.safeParse(draft);
  return result.success ? null : (firstError(result) ?? 'Revisa los datos de la carrera');
}

/** The race to create/update, or null with "Aún no tengo carrera". */
export function goalRaceDraft(goal: GoalInput): RaceDraft | null {
  if (!goal.hasRace || !goal.race.date) return null;
  return { name: goal.race.name.trim(), date: goal.race.date, distance: goal.race.distance, priority: 'A' };
}

/** True when the prefilled race was edited (or there is a new one to create). */
export function raceNeedsSave(goal: GoalInput, races: readonly Race[]): boolean {
  const draft = goalRaceDraft(goal);
  if (!draft) return false;
  const existing = goal.raceId ? races.find((r) => r.id === goal.raceId) : undefined;
  if (!existing) return true;
  return existing.name !== draft.name || existing.date !== draft.date || existing.distance !== draft.distance;
}

/** Only the sports: the availability stays as it is (automatic unless the athlete chose manual). */
export function goalProfilePatch(goal: GoalInput): ProfilePatch {
  return { sports: goal.sports };
}
