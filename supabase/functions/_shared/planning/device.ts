/**
 * Planned workouts → Garmin Training API V2-like JSON (docs/research/04 §3.7),
 * so the user's own Garmin connector in Claude can upload them to the watch.
 * Targets use the athlete's thresholds when known (power for bike, heart rate
 * from LTHR otherwise); pace hints go into the step description.
 */
import type { Intensity, Sport, Thresholds, Workout, WorkoutStep } from '../types.ts';
import { formatDuration, intensityLabel, sportLabel } from './labels.ts';

export type GarminSport = 'RUNNING' | 'CYCLING' | 'LAP_SWIMMING' | 'STRENGTH_TRAINING' | 'OTHER';

const GARMIN_SPORT: Record<Exclude<Sport, 'brick' | 'rest'>, GarminSport> = {
  run: 'RUNNING',
  bike: 'CYCLING',
  swim: 'LAP_SWIMMING',
  strength: 'STRENGTH_TRAINING',
  mobility: 'OTHER',
  other: 'OTHER',
};

const STEP_INTENSITY: Record<WorkoutStep['kind'], string> = {
  warmup: 'WARMUP',
  work: 'ACTIVE',
  recovery: 'RECOVERY',
  cooldown: 'COOLDOWN',
  rest: 'REST',
};

const POWER_PCT: Record<Intensity, [number, number]> = {
  recovery: [0.45, 0.55],
  endurance: [0.56, 0.75],
  tempo: [0.76, 0.9],
  threshold: [0.91, 1.05],
  vo2: [1.06, 1.2],
  race: [0.75, 0.85],
};

const HR_PCT_LTHR: Record<Intensity, [number, number]> = {
  recovery: [0.7, 0.84],
  endurance: [0.85, 0.89],
  tempo: [0.9, 0.94],
  threshold: [0.95, 0.99],
  vo2: [1.0, 1.06],
  race: [0.9, 0.97],
};

/** Run pace as % of threshold pace (>1 = slower). */
const PACE_PCT: Record<Intensity, [number, number]> = {
  recovery: [1.3, 1.45],
  endurance: [1.14, 1.29],
  tempo: [1.06, 1.13],
  threshold: [0.99, 1.05],
  vo2: [0.9, 0.96],
  race: [1.02, 1.1],
};

const CSS_OFFSET_SEC: Record<Intensity, [number, number]> = {
  recovery: [15, 20],
  endurance: [8, 15],
  tempo: [4, 8],
  threshold: [-1, 3],
  vo2: [-6, -2],
  race: [2, 4],
};

const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function paceHint(sport: Sport, intensity: Intensity, t: Thresholds): string | null {
  if (sport === 'run' && t.runThresholdPaceSecPerKm) {
    const [a, b] = PACE_PCT[intensity];
    return `${mmss(t.runThresholdPaceSecPerKm * a)}–${mmss(t.runThresholdPaceSecPerKm * b)} /km`;
  }
  if (sport === 'swim' && t.swimCssSecPer100m) {
    const [a, b] = CSS_OFFSET_SEC[intensity];
    return `${mmss(t.swimCssSecPer100m + a)}–${mmss(t.swimCssSecPer100m + b)} /100 m`;
  }
  return null;
}

function target(sport: Sport, intensity: Intensity, t: Thresholds): Record<string, unknown> {
  if (sport === 'bike' && t.ftpW) {
    const [a, b] = POWER_PCT[intensity];
    return { targetType: 'POWER', targetValueLow: Math.round(t.ftpW * a), targetValueHigh: Math.round(t.ftpW * b) };
  }
  if ((sport === 'run' || sport === 'bike') && t.lthr) {
    const [a, b] = HR_PCT_LTHR[intensity];
    return { targetType: 'HEART_RATE', targetValueLow: Math.round(t.lthr * a), targetValueHigh: Math.round(t.lthr * b) };
  }
  return { targetType: 'OPEN' };
}

function stepJson(step: WorkoutStep, order: number, sport: Sport, fallback: Intensity, t: Thresholds): Record<string, unknown> {
  const intensity = step.intensity ?? (step.kind === 'work' ? fallback : 'recovery');
  const duration =
    step.durationMin !== undefined
      ? { durationType: 'TIME', durationValue: Math.round(step.durationMin * 60) }
      : step.distanceM !== undefined
        ? { durationType: 'DISTANCE', durationValue: step.distanceM }
        : { durationType: 'OPEN' };
  const hint = paceHint(sport, intensity, t);
  const description = [intensityLabel(intensity), hint, step.note].filter(Boolean).join(' · ');
  const single = { type: 'WorkoutStep', stepOrder: 1, intensity: STEP_INTENSITY[step.kind], description, ...duration, ...target(sport, intensity, t) };
  if (step.repeat && step.repeat > 1) {
    return { type: 'WorkoutRepeatStep', stepOrder: order, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: step.repeat, steps: [single] };
  }
  return { ...single, stepOrder: order };
}

/** Default structure when the plan has no steps: warm-up, main block, cool-down. */
export function defaultSteps(durationMin: number, intensity: Intensity): WorkoutStep[] {
  if (durationMin < 30) return [{ kind: 'work', durationMin, intensity }];
  const warm = durationMin >= 60 ? 15 : 10;
  const cool = durationMin >= 60 ? 10 : 5;
  return [
    { kind: 'warmup', durationMin: warm, intensity: 'recovery' },
    { kind: 'work', durationMin: durationMin - warm - cool, intensity },
    { kind: 'cooldown', durationMin: cool, intensity: 'recovery' },
  ];
}

function stepsDuration(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

function garminWorkout(w: Workout, sport: Exclude<Sport, 'brick' | 'rest'>, durationMin: number, steps: WorkoutStep[], t: Thresholds, suffix = ''): Record<string, unknown> {
  const garminSport = GARMIN_SPORT[sport];
  const seconds = Math.round((stepsDuration(steps) || durationMin) * 60);
  return {
    workoutName: `${w.title}${suffix}`.slice(0, 60),
    description: [w.description, `Road to Ironman · ${intensityLabel(w.intensity)} · ${formatDuration(durationMin)}`].filter(Boolean).join('\n').slice(0, 1000),
    sport: garminSport,
    workoutProvider: 'Road to Ironman',
    workoutSourceId: w.id,
    estimatedDurationInSecs: seconds,
    segments: [
      {
        segmentOrder: 1,
        sport: garminSport,
        estimatedDurationInSecs: seconds,
        steps: steps.map((s, i) => stepJson(s, i + 1, sport, w.intensity, t)),
      },
    ],
    scheduledDate: w.date,
  };
}

/** One planned workout → one Garmin workout (two for a brick: bike + run off the bike). */
export function toGarminWorkouts(w: Workout, t: Thresholds): Record<string, unknown>[] {
  if (w.sport === 'rest' || w.durationMin <= 0) return [];
  if (w.sport === 'brick') {
    const bikeMin = Math.round(w.durationMin * 0.75);
    const runMin = w.durationMin - bikeMin;
    return [
      garminWorkout(w, 'bike', bikeMin, defaultSteps(bikeMin, w.intensity), t, ' · bici'),
      garminWorkout(w, 'run', runMin, [{ kind: 'work', durationMin: runMin, intensity: w.intensity }], t, ' · carrera'),
    ];
  }
  const steps = w.steps.length > 0 ? w.steps : defaultSteps(w.durationMin, w.intensity);
  return [garminWorkout(w, w.sport, w.durationMin, steps, t)];
}

export function deviceSummary(w: Workout, t: Thresholds): string {
  const hint = w.sport === 'brick' ? null : paceHint(w.sport, w.intensity, t);
  return `${sportLabel(w.sport)} · ${w.title} · ${formatDuration(w.durationMin)} · ${intensityLabel(w.intensity)}${hint ? ` (${hint})` : ''}`;
}
