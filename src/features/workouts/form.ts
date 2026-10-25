/** Pure state helpers for the workout editor form. */
import { SPORTS, type ISODate, type ISOTime, type Intensity, type Sport, type Workout, type WorkoutDraft, type WorkoutStep } from '@/domain/types';

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
    steps: state.steps.map((s) => ({ ...s })),
    isKey: state.isKey,
    ...(source ? { source } : {}),
  };
}

/** Planned load must be re-estimated when what drives it changes. */
export function shouldResetTss(before: Pick<Workout, 'sport' | 'durationMin' | 'intensity'>, draft: WorkoutDraft): boolean {
  return before.sport !== draft.sport || before.durationMin !== draft.durationMin || before.intensity !== draft.intensity;
}

// --- steps editor ---------------------------------------------------------

export function addStep(steps: readonly WorkoutStep[], intensity: Intensity): WorkoutStep[] {
  const kind = steps.length === 0 ? 'warmup' : 'work';
  return [...steps, { kind, durationMin: 10, intensity: kind === 'warmup' ? 'recovery' : intensity }];
}

export function updateStep(steps: readonly WorkoutStep[], index: number, patch: Partial<WorkoutStep>): WorkoutStep[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function removeStep(steps: readonly WorkoutStep[], index: number): WorkoutStep[] {
  return steps.filter((_, i) => i !== index);
}
