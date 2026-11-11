/**
 * Deterministic session library (docs/research/02 §9): each session code maps
 * to sport, class and intensity and builds a Spanish title, a one-sentence
 * description, a simple, watch-friendly WorkoutStep[] structure (cues, brick
 * legs and explicit targets only where the zone alone is not enough) and the
 * coach's prescription (objective, keys, success criterion, plan B) with the
 * athlete's numbers when the thresholds are known (`SessionContext`).
 *
 * Recipes live in `sessionsSwim|Bike|Run|Misc.ts`, building blocks in
 * `sessionKit.ts` and the easier version in `sessionEasier.ts`.
 *
 * Step convention: consecutive steps sharing the same `repeat` form one
 * interval set, e.g. work 8' ×4 followed by recovery 3' ×4 = (8' + 3') × 4.
 */
import { HARD_POINTS } from './constants';
import { formatDuration } from './dates';
import { longPoints, workoutHardPoints } from './hardness';
import { estimateTss } from './load';
import { intensityRank } from './restrictions';
import { planBSentence } from './sessionEasier';
import {
  coachingOf,
  mainNumbers,
  specClass,
  specIntensity,
  specSport,
  type SessionCode,
  type SessionContent,
  type SessionContext,
  type SessionRecipe,
  type SessionSpec,
} from './sessionKit';
import { BIKE_RECIPES } from './sessionsBike';
import { MISC_RECIPES } from './sessionsMisc';
import { RUN_RECIPES } from './sessionsRun';
import { SWIM_RECIPES } from './sessionsSwim';
import type { Intensity, ISOTime, Sport, WorkoutDraft } from './types';

export { SESSION_CATALOG, specClass, specIntensity, specSport } from './sessionKit';
export type { SessionBody, SessionClass, SessionCode, SessionContent, SessionContext, SessionSpec } from './sessionKit';

const RECIPES: Readonly<Record<SessionCode, SessionRecipe>> = {
  ...SWIM_RECIPES,
  ...BIKE_RECIPES,
  ...RUN_RECIPES,
  ...MISC_RECIPES,
};

/** Defensive fallback for a code missing at runtime (old data): a plain session without structure. */
const FALLBACK: SessionRecipe = {
  body: (_s, d) => ({ title: 'Entreno', description: formatDuration(d), steps: [] }),
  coach: ({ planB }) => coachingOf('Sumar trabajo aeróbico sin fatiga.', [], 'Acabas con la sensación de poder hacer más.', planB),
};

export function isQualitySpec(spec: SessionSpec): boolean {
  const cls = specClass(spec);
  return cls === 'QUALITY' || cls === 'BRICK';
}

export function isLongSpec(spec: SessionSpec): boolean {
  return specClass(spec) === 'LONG';
}

/** Bike/run QUALITY (incl. brick) — the ones counted by the weekly quality budget. */
export function isEnduranceQuality(spec: SessionSpec): boolean {
  const sport = specSport(spec);
  return isQualitySpec(spec) && (sport === 'bike' || sport === 'run' || sport === 'brick');
}

function classHardPoints(spec: SessionSpec, sport: Sport, intensity: Intensity): number {
  switch (specClass(spec)) {
    case 'RACE':
      return HARD_POINTS.race;
    case 'BRICK':
      return HARD_POINTS.brick;
    case 'LONG':
      return longPoints(sport, intensity, spec.durationMin);
    case 'QUALITY':
      if (sport === 'swim') return HARD_POINTS.swimQuality;
      if (sport === 'strength') return HARD_POINTS.strengthHeavy;
      return HARD_POINTS.quality;
    default:
      return spec.code === 'ST_MAINT' ? HARD_POINTS.strengthMaint : 0;
  }
}

/**
 * §10.1 hard points of a catalog session. Never lower than what the saved
 * workout will score (an 80' "easy" run is a long run for the rules), so the
 * planner and the re-planner agree on hard days.
 */
export function specHardPoints(spec: SessionSpec): number {
  const sport = specSport(spec);
  const intensity = specIntensity(spec);
  return Math.max(classHardPoints(spec, sport, intensity), workoutHardPoints({ sport, intensity, durationMin: spec.durationMin }));
}

/**
 * Title, description, steps and coaching for a session. `ctx` (thresholds,
 * target race distance) only adds numbers: the structure never depends on it.
 */
export function buildSession(spec: SessionSpec, sessionCtx: SessionContext = {}): SessionContent {
  const d = Math.max(0, Math.round(spec.durationMin));
  const recipe = RECIPES[spec.code] ?? FALLBACK;
  // Race day and activation of a B race: that race's pace, not the target race's.
  const ctx = spec.raceDistance ? { ...sessionCtx, raceDistance: spec.raceDistance } : sessionCtx;
  const body = recipe.body(spec, d, ctx);
  const sport = specSport(spec);
  const intensity = specIntensity(spec);
  const main = mainNumbers(sport, intensity, body.steps, ctx);
  const planB = planBSentence({ sport, intensity, durationMin: d }, ctx, spec.code);
  const coaching = recipe.coach({ spec, d, body, ctx, sport, intensity, main, planB });
  const description = spec.note ? `${body.description} ${spec.note}` : body.description;
  return { ...body, description, coaching };
}

const SWIM_MIN_PER_100_ESTIMATE = 1.9;
const TEMPO_RANK = intensityRank('tempo');

/** Minutes above Z2 (tempo or harder) in the session's steps (intensity distribution checks). */
export function hardMinutes(spec: SessionSpec): number {
  return buildSession(spec).steps.reduce((sum, step) => {
    if (!step.intensity || intensityRank(step.intensity) < TEMPO_RANK) return sum;
    const minutes = step.durationMin ?? (step.distanceM ? (step.distanceM / 100) * SWIM_MIN_PER_100_ESTIMATE : 0);
    return sum + minutes * (step.repeat ?? 1);
  }, 0);
}

/** WorkoutDraft for a placed session (source 'rules'), with coaching and, given `ctx`, the athlete's targets. */
export function specToDraft(spec: SessionSpec, date: string, startTime: ISOTime | null, ctx: SessionContext = {}): WorkoutDraft {
  const content = buildSession(spec, ctx);
  const sport = specSport(spec);
  const intensity = specIntensity(spec);
  const durationMin = Math.max(0, Math.round(spec.durationMin));
  return {
    date,
    startTime,
    sport,
    title: content.title,
    description: content.description,
    durationMin,
    distanceM: spec.distanceM ?? null,
    intensity,
    tss: estimateTss({ sport, durationMin, intensity }),
    steps: content.steps,
    coaching: content.coaching,
    isKey: spec.priority <= 2,
    source: 'rules',
  };
}
