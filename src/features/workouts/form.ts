/** Pure state helpers for the workout editor form. */
import {
  SPORTS,
  type ISODate,
  type ISOTime,
  type Intensity,
  type Sport,
  type Workout,
  type WorkoutDraft,
  type WorkoutPatch,
  type WorkoutStep,
} from '@/domain/types';

import { formatDistanceInput, parseDistanceInput } from './draft';
import type { WorkoutTemplate } from './templates';

export interface WorkoutFormState {
  sport: Sport;
  title: string;
  date: ISODate;
  startTime: ISOTime | null;
  durationMin: number;
  /** Raw text in the sport's unit (km, or m for swim). */
  distance: string;
  intensity: Intensity;
  isKey: boolean;
  description: string;
  steps: WorkoutStep[];
}

const DEFAULT_DURATION: Record<Sport, number> = {
  swim: 45,
  bike: 60,
  run: 45,
  brick: 90,
  strength: 45,
  mobility: 20,
  other: 60,
  rest: 0,
};

export function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && (SPORTS as readonly string[]).includes(value);
}

export function emptyForm(date: ISODate, sport: Sport = 'run'): WorkoutFormState {
  return {
    sport,
    title: '',
    date,
    startTime: null,
    durationMin: DEFAULT_DURATION[sport],
    distance: '',
    intensity: sport === 'rest' || sport === 'mobility' ? 'recovery' : 'endurance',
    isKey: false,
    description: '',
    steps: [],
  };
}

export function workoutToForm(w: Workout): WorkoutFormState {
  return {
    sport: w.sport,
    title: w.title,
    date: w.date,
    startTime: w.startTime,
    durationMin: w.durationMin,
    distance: formatDistanceInput(w.distanceM, w.sport),
    intensity: w.intensity,
    isKey: w.isKey,
    description: w.description ?? '',
    steps: w.steps.map((s) => ({ ...s })),
  };
}

/** Switching sport keeps what the user typed but resets an untouched duration. */
export function changeSport(state: WorkoutFormState, sport: Sport): WorkoutFormState {
  const untouched = state.durationMin === DEFAULT_DURATION[state.sport];
  return {
    ...state,
    sport,
    durationMin: untouched ? DEFAULT_DURATION[sport] : state.durationMin,
    distance: state.sport === sport ? state.distance : '',
    intensity: sport === 'rest' ? 'recovery' : state.intensity,
  };
}

export function applyTemplate(state: WorkoutFormState, t: WorkoutTemplate): WorkoutFormState {
  return {
    ...state,
    sport: t.sport,
    title: t.title,
    durationMin: t.durationMin,
    intensity: t.intensity,
    distance: formatDistanceInput(t.distanceM ?? null, t.sport),
    isKey: t.isKey ?? false,
    description: t.description ?? state.description,
    steps: t.steps.map((s) => ({ ...s })),
  };
}

/** Copy of a step with `cue` set to `text`, or without a cue when `text` is blank. */
function withCue(step: WorkoutStep, text: string | undefined): WorkoutStep {
  const { cue: _previous, ...rest } = step;
  return text && text.trim() ? { ...rest, cue: text } : rest;
}

/** Copy of a step with a trimmed cue (an empty one is dropped). */
function cleanStep(step: WorkoutStep): WorkoutStep {
  return withCue(step, step.cue?.trim());
}

/** Form → draft accepted by the repository / validation schema. */
export function formToDraft(state: WorkoutFormState, source?: WorkoutDraft['source']): WorkoutDraft {
  const description = state.description.trim();
  return {
    date: state.date,
    startTime: state.startTime,
    sport: state.sport,
    title: state.title.trim(),
    description: description ? description : null,
    durationMin: state.sport === 'rest' ? 0 : Math.max(0, Math.round(state.durationMin)),
    distanceM: state.sport === 'rest' ? null : parseDistanceInput(state.distance, state.sport),
    intensity: state.intensity,
    steps: state.steps.map(cleanStep),
    isKey: state.isKey,
    ...(source ? { source } : {}),
  };
}

/** Planned load must be re-estimated when what drives it changes. */
export function shouldResetTss(before: Pick<Workout, 'sport' | 'durationMin' | 'intensity'>, draft: WorkoutDraft): boolean {
  return before.sport !== draft.sport || before.durationMin !== draft.durationMin || before.intensity !== draft.intensity;
}

/** The coach's objective, keys and plan B describe a sport and an intensity: drop them when either changes. */
export function shouldResetCoaching(
  before: Pick<Workout, 'sport' | 'intensity' | 'coaching'>,
  change: Pick<WorkoutPatch, 'sport' | 'intensity'>,
): boolean {
  if (!before.coaching) return false;
  const sportChanged = change.sport !== undefined && change.sport !== before.sport;
  return sportChanged || (change.intensity !== undefined && change.intensity !== before.intensity);
}

/** A patch that changes sport or intensity without new coaching clears the old one ("No es mi día", moves…). */
export function withoutStaleCoaching(before: Pick<Workout, 'sport' | 'intensity' | 'coaching'>, patch: WorkoutPatch): WorkoutPatch {
  if (patch.coaching !== undefined || !shouldResetCoaching(before, patch)) return patch;
  return { ...patch, coaching: null };
}

/** Patch for an edited workout: re-estimated load and stale coaching cleared (`coaching: null`). */
export function editPatch(before: Workout, draft: WorkoutDraft): WorkoutDraft {
  const reset = shouldResetCoaching(before, draft);
  return {
    ...draft,
    ...(shouldResetTss(before, draft) ? { tss: null } : {}),
    ...(reset ? { coaching: null } : {}),
    // Explicit targets were written for the old sport/intensity: let the zones derive new ones.
    ...(reset && draft.steps ? { steps: draft.steps.map(withoutExplicitTargets) } : {}),
  };
}

function withoutExplicitTargets(step: WorkoutStep): WorkoutStep {
  const { target: _target, ...rest } = step;
  return rest;
}

// --- steps editor ---------------------------------------------------------

export function addStep(steps: readonly WorkoutStep[], intensity: Intensity): WorkoutStep[] {
  const kind = steps.length === 0 ? 'warmup' : 'work';
  return [...steps, { kind, durationMin: 10, intensity: kind === 'warmup' ? 'recovery' : intensity }];
}

export function updateStep(steps: readonly WorkoutStep[], index: number, patch: Partial<WorkoutStep>): WorkoutStep[] {
  return steps.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, ...patch };
    // A new intensity makes the step's explicit targets (ppm, W, pace) stale.
    const intensityChanged = patch.intensity !== undefined && patch.intensity !== s.intensity;
    return intensityChanged && !patch.target ? withoutExplicitTargets(next) : next;
  });
}

/** Max length of a step cue (validation + DB). */
export const STEP_CUE_MAX = 200;

/** Sets or clears a step's cue (sensations / technique); blank text removes it. */
export function setStepCue(steps: readonly WorkoutStep[], index: number, text: string): WorkoutStep[] {
  const cue = text.slice(0, STEP_CUE_MAX);
  return steps.map((s, i) => (i === index ? withCue(s, cue) : s));
}

export function removeStep(steps: readonly WorkoutStep[], index: number): WorkoutStep[] {
  return steps.filter((_, i) => i !== index);
}
