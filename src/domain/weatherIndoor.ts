/**
 * Indoor versions of an outdoor session for a rainy or very windy day (pure, app only):
 * - bike → the same session on the trainer (title "Rodillo · …", same structure);
 * - brick → trainer: the bike as planned and, instead of running, ~1,3× that
 *   time on the trainer at high cadence;
 * - run → pool or trainer with a similar load (planned TSS), pool when a swim
 *   fits the day (pool day, the athlete swims, no other swim that day, room
 *   for it and a sensible length), trainer otherwise.
 * Every version says why in its description. Used by `weatherPlan.ts`.
 */
import { formatDuration } from './dates';
import { estimateTss } from './load';
import { buildSession, type SessionCode, type SessionContext } from './sessions';
import type { Intensity, Sport, Workout, WorkoutCoaching, WorkoutDraft, WorkoutStep } from './types';

/** Minutes on the bike for each minute of running (same effort; also the injury rule of thumb). */
export const RUN_TO_BIKE = 1.3;
const BIKE_MIN = 30;
const BIKE_MAX = 150;
const SWIM_MIN = 30;
const SWIM_MAX = 75;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 1000;

export type IndoorKind = 'trainer' | 'pool';

export interface IndoorVersion {
  kind: IndoorKind;
  patch: Partial<WorkoutDraft>;
}

export interface IndoorOptions {
  /** A swim fits the day (pool day, the athlete swims, no other swim, room for it). */
  poolFits: (swimMin: number) => boolean;
  /** Longest the session may last from its start time (free time), if it has one. */
  maxMin?: number | null;
  sessionCtx?: SessionContext;
  /** Why it changes, first part of the sentence ("Llueve y no hay hueco seco"). */
  why: string;
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Minutes of `sport` at `intensity` with about `tss` of load. */
export function minutesForLoad(sport: Sport, intensity: Intensity, tss: number): number {
  const perHour = estimateTss({ sport, intensity, durationMin: 60 });
  return perHour > 0 ? round5((tss / perHour) * 60) : 0;
}

export function rodilloTitle(title: string): string {
  const clean = title.trim();
  return /rodillo/i.test(clean) ? clean : `Rodillo · ${clean}`.slice(0, TITLE_MAX);
}

function withSentence(description: string | null, sentence: string): string {
  const base = description?.trim();
  return (base ? `${base} ${sentence}` : sentence).slice(0, DESCRIPTION_MAX);
}

const BIKE_CODES: Record<Intensity, SessionCode> = {
  recovery: 'BK_REC',
  endurance: 'BK_END',
  tempo: 'BK_TEMPO',
  threshold: 'BK_THR',
  vo2: 'BK_VO2',
  race: 'BK_RP',
};

const SWIM_CODES: Record<Intensity, SessionCode> = {
  recovery: 'SW_TECH',
  endurance: 'SW_END',
  tempo: 'SW_CSS',
  threshold: 'SW_CSS',
  vo2: 'SW_SPEED',
  race: 'SW_CSS',
};

const SWIM_INTENSITY: Record<Intensity, Intensity> = {
  recovery: 'endurance',
  endurance: 'endurance',
  tempo: 'threshold',
  threshold: 'threshold',
  vo2: 'vo2',
  race: 'threshold',
};

/** Same bike session on the trainer. */
function bikeIndoors(w: Workout, why: string): IndoorVersion {
  return {
    kind: 'trainer',
    patch: { title: rodilloTitle(w.title), description: withSentence(w.description, `${why}: la misma sesión en rodillo.`) },
  };
}

function brickSteps(steps: readonly WorkoutStep[]): { steps: WorkoutStep[]; bikeMin: number; extraMin: number } {
  let bikeMin = 0;
  let extraMin = 0;
  const out = steps.map((step): WorkoutStep => {
    const { leg, ...rest } = step;
    const reps = step.repeat ?? 1;
    if (leg !== 'run') {
      bikeMin += (step.durationMin ?? 0) * reps;
      return rest;
    }
    const minutes = round5((step.durationMin ?? 0) * RUN_TO_BIKE);
    extraMin += minutes * reps;
    return { ...rest, durationMin: minutes, cue: 'En vez de correr: sigue en el rodillo con cadencia alta y las piernas sueltas.' };
  });
  return { steps: out, bikeMin, extraMin };
}

const BRICK_COACHING = (planB: string | null): WorkoutCoaching => ({
  objective: 'Mantener el estímulo de la transición sin salir con mal tiempo.',
  keys: ['La parte de bici, como estaba planificada.', 'El tramo que ibas a correr, en rodillo con cadencia alta.'],
  success: 'Acabas el último bloque con la cadencia alta y sin hundirte.',
  planB,
});

/** Brick → trainer: the bike as planned, the run replaced by ~1,3× its time on the bike. */
function brickIndoors(w: Workout, why: string): IndoorVersion {
  const fallbackRun = Math.max(10, Math.round(w.durationMin * 0.2));
  const built = w.steps.length > 0 ? brickSteps(w.steps) : null;
  const bikeMin = built ? built.bikeMin : w.durationMin - fallbackRun;
  const extraMin = built ? built.extraMin : round5(fallbackRun * RUN_TO_BIKE);
  const durationMin = Math.max(BIKE_MIN, Math.round(bikeMin + extraMin));
  return {
    kind: 'trainer',
    patch: {
      sport: 'bike',
      title: `Rodillo ${formatDuration(durationMin)}`,
      description: `${why}: el brick pasa a rodillo. ${formatDuration(bikeMin)} de bici como estaba y, en vez de correr, ${formatDuration(extraMin)} más de rodillo con cadencia alta.`,
      steps: built ? built.steps : [],
      durationMin,
      distanceM: null,
      tss: estimateTss({ sport: 'bike', intensity: w.intensity, durationMin }),
      coaching: BRICK_COACHING(w.coaching?.planB ?? null),
    },
  };
}

function rebuilt(sport: 'bike' | 'swim', intensity: Intensity, durationMin: number, note: string, ctx: SessionContext): Partial<WorkoutDraft> {
  const code = sport === 'swim' ? SWIM_CODES[intensity] : durationMin >= 120 && intensity === 'endurance' ? 'BK_LONG' : BIKE_CODES[intensity];
  const content = buildSession({ code, durationMin, priority: 4, note }, ctx);
  return {
    sport,
    intensity,
    durationMin,
    distanceM: null,
    title: sport === 'bike' ? rodilloTitle(content.title) : content.title,
    description: content.description.slice(0, DESCRIPTION_MAX),
    steps: content.steps,
    coaching: content.coaching,
    tss: estimateTss({ sport, intensity, durationMin }),
  };
}

/** Run → pool when a swim of similar load fits the day, else trainer. */
function runIndoors(w: Workout, opts: IndoorOptions): IndoorVersion {
  const load = w.tss ?? estimateTss(w);
  const swimIntensity = SWIM_INTENSITY[w.intensity];
  const swimMin = minutesForLoad('swim', swimIntensity, load);
  const ctx = opts.sessionCtx ?? {};
  if (swimMin >= SWIM_MIN && swimMin <= SWIM_MAX && opts.poolFits(swimMin)) {
    const note = `${opts.why}: cambio la carrera por piscina con una carga parecida.`;
    return { kind: 'pool', patch: rebuilt('swim', swimIntensity, swimMin, note, ctx) };
  }
  const wanted = clamp(minutesForLoad('bike', w.intensity, load), BIKE_MIN, BIKE_MAX);
  // A timed session keeps its start: never longer than the free time after it (never shorter than the run).
  const room = opts.maxMin != null && opts.maxMin >= w.durationMin ? Math.floor(opts.maxMin / 5) * 5 : null;
  const bikeMin = room === null ? wanted : Math.max(w.durationMin, Math.min(wanted, room));
  const note = `${opts.why}: cambio la carrera por rodillo con una carga parecida.`;
  return { kind: 'trainer', patch: rebuilt('bike', w.intensity, bikeMin, note, ctx) };
}

/** The indoor version of an outdoor session, or null for anything else. */
export function indoorVersion(w: Workout, opts: IndoorOptions): IndoorVersion | null {
  if (w.sport === 'bike') return bikeIndoors(w, opts.why);
  if (w.sport === 'brick') return brickIndoors(w, opts.why);
  if (w.sport === 'run') return runIndoors(w, opts);
  return null;
}
