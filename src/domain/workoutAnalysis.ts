/**
 * The rules version of "Analizar" (demo, AI off or unavailable): the coach's
 * plan-vs-real verdict (`review.ts`) turned into the same shape as the AI
 * analysis, plus what that morning's journal explains (alcohol, a niggle,
 * feeling ill) and what tomorrow holds. Never invents numbers. Pure.
 */
import { reviewWorkout, type ReviewVerdict } from './review';
import type { DailyCheckin, ISODateTime, RaceDistance, Thresholds, Workout, WorkoutAnalysis } from './types';

export interface RulesAnalysisInput {
  workout: Workout;
  thresholds: Thresholds | null;
  raceDistance: RaceDistance | null;
  /** That morning's check-in, if any. */
  checkin: DailyCheckin | null;
  /** Planned sessions of the next day (for the next step). */
  tomorrow: readonly Workout[];
  now: ISODateTime;
}

const GOOD_VERDICTS: ReadonlySet<ReviewVerdict> = new Set(['on_target', 'easier']);

/** Journal answers that help explain a hard session, in the coach's words. */
function journalHints(checkin: DailyCheckin | null): string[] {
  if (!checkin) return [];
  const h = checkin.habits;
  return [
    h.sick === true ? 'Esta mañana te notabas enfermo: con eso, el pulso y el esfuerzo suben solos.' : null,
    h.alcohol === true ? 'Ayer bebiste alcohol: suele subir el pulso y bajar la recuperación al día siguiente.' : null,
    h.niggle === true ? 'Tenías una molestia: si ha ido a más al entrenar, dale un día de descanso y vigílala.' : null,
    h.late_meal === true || h.screens_in_bed === true ? 'Cenar tarde o el móvil en la cama restan sueño de calidad: cuídalo esta noche.' : null,
  ].filter((p): p is string => p !== null);
}

function tomorrowLine(tomorrow: readonly Workout[]): string | null {
  const next = tomorrow.find((w) => w.sport !== 'rest');
  if (!next) return tomorrow.length > 0 ? 'Mañana descansas: aprovecha para recuperar.' : null;
  return `Mañana toca «${next.title}» (${next.durationMin}').`;
}

/** Rules analysis of a completed workout; null for planned, skipped and rest days. */
export function rulesAnalysis(input: RulesAnalysisInput): WorkoutAnalysis | null {
  const review = reviewWorkout(input.workout, input.thresholds, { raceDistance: input.raceDistance });
  if (!review) return null;
  const good = GOOD_VERDICTS.has(review.verdict);
  const hard = review.verdict === 'harder';
  const hints = journalHints(input.checkin);
  const improve = [...(good || !review.next ? [] : [review.next]), ...(hard ? hints : hints.slice(0, 1))].slice(0, 3);
  const nextStep = [hard ? 'Hoy, recupera: come, hidrátate y duerme bien.' : null, tomorrowLine(input.tomorrow)]
    .filter((p): p is string => p !== null)
    .join(' ');
  return {
    workoutId: input.workout.id,
    headline: review.title,
    wentWell: good ? [review.detail] : ['Sesión hecha: cada entreno suma.'],
    improve,
    nextStep: nextStep || (review.next ?? 'Sigue con tu plan.'),
    engine: 'rules',
    createdAt: input.now,
  };
}
