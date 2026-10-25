/** Pure helpers for structured workout steps (visualisation + editor). */
import { formatDuration } from '@/domain/dates';
import type { Intensity, Sport, WorkoutStep, WorkoutStepKind } from '@/domain/types';

export const STEP_KINDS: readonly WorkoutStepKind[] = ['warmup', 'work', 'recovery', 'cooldown', 'rest'];

const STEP_KIND_LABEL: Record<WorkoutStepKind, string> = {
  warmup: 'Calentamiento',
  work: 'Trabajo',
  recovery: 'Recuperación',
  cooldown: 'Vuelta a la calma',
  rest: 'Descanso',
};

export function stepKindLabel(kind: WorkoutStepKind): string {
  return STEP_KIND_LABEL[kind];
}

export interface StepSegment {
  key: string;
  intensity: Intensity;
  /** Relative width weight (minutes × repeats, or distance proxy). */
  weight: number;
  label: string;
}

/** Relative weight of one step; distance-only steps use ~2 min / 100 m (swim pace proxy). */
export function stepWeight(step: WorkoutStep): number {
  const repeat = Math.max(1, step.repeat ?? 1);
  const base = step.durationMin ?? (step.distanceM != null ? step.distanceM / 50 : 1);
  return Math.max(0.5, base) * repeat;
}

/** Human label: "6× 4' · Trabajo" / "200 m · Calentamiento". */
export function stepLabel(step: WorkoutStep, sport: Sport): string {
  const repeat = step.repeat && step.repeat > 1 ? `${step.repeat}× ` : '';
  const amount =
    step.durationMin != null
      ? formatDuration(step.durationMin)
      : step.distanceM != null
        ? sport === 'swim'
          ? `${step.distanceM} m`
          : `${(step.distanceM / 1000).toLocaleString('es-ES')} km`
        : '';
  const head = `${repeat}${amount}`.trim();
  const kind = stepKindLabel(step.kind);
  return head ? `${head} · ${kind}` : kind;
}

/** Expands steps into proportional segments; repeats of work/recovery pairs stay grouped. */
export function stepSegments(steps: readonly WorkoutStep[], fallback: Intensity, sport: Sport): StepSegment[] {
  return steps.map((step, index) => ({
    key: `${index}-${step.kind}`,
    intensity: step.intensity ?? (step.kind === 'work' ? fallback : 'recovery'),
    weight: stepWeight(step),
    label: stepLabel(step, sport),
  }));
}

/** Total planned minutes of the steps (null when any step lacks a duration). */
export function stepsTotalMinutes(steps: readonly WorkoutStep[]): number | null {
  if (steps.length === 0) return null;
  let total = 0;
  for (const step of steps) {
    if (step.durationMin == null) return null;
    total += step.durationMin * Math.max(1, step.repeat ?? 1);
  }
  return total;
}
