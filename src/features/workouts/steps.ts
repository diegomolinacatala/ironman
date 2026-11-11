/** Pure helpers for structured workout steps (visualisation + editor). */
import { stepLines } from '@/domain/prescription';
import type { Intensity, Sport, WorkoutStep, WorkoutStepKind } from '@/domain/types';
import { formatStepAmount } from '@/domain/zones';

export const STEP_KINDS: readonly WorkoutStepKind[] = ['warmup', 'work', 'recovery', 'cooldown', 'rest'];

const STEP_KIND_LABEL: Record<WorkoutStepKind, string> = {
  warmup: 'Calentamiento',
  work: 'Trabajo',
  recovery: 'Recuperación',
  cooldown: 'Vuelta a la calma',
  rest: 'Descanso',
};

const LEG_LABEL: Record<'bike' | 'run', string> = { bike: 'bici', run: 'carrera' };

export function stepKindLabel(kind: WorkoutStepKind): string {
  return STEP_KIND_LABEL[kind];
}

export interface StepSegment {
  key: string;
  intensity: Intensity;
  /** Relative width weight (minutes × repeats, or distance proxy). */
  weight: number;
  /** Legend: "3×8' · Series · Z4", "60' · Parte principal · bici · Z2". */
  label: string;
}

/** Relative weight of one step; distance-only steps use ~2 min / 100 m (swim pace proxy). */
export function stepWeight(step: WorkoutStep): number {
  const repeat = Math.max(1, step.repeat ?? 1);
  const base = step.durationMin ?? (step.distanceM != null ? step.distanceM / 50 : 1);
  return Math.max(0.5, base) * repeat;
}

/**
 * Short label: "6× 4' · Trabajo", "8× 30" · Trabajo", "400 m · Calentamiento",
 * "15' · Trabajo · carrera" (brick leg). Seconds-aware; the sport is kept for callers.
 */
export function stepLabel(step: WorkoutStep, _sport?: Sport): string {
  const repeat = step.repeat && step.repeat > 1 ? `${step.repeat}× ` : '';
  const head = `${repeat}${formatStepAmount(step)}`.trim();
  const kind = `${stepKindLabel(step.kind)}${step.leg ? ` · ${LEG_LABEL[step.leg]}` : ''}`;
  return head ? `${head} · ${kind}` : kind;
}

/** Proportional segments for the bar; each legend line says amount, label and zone. */
export function stepSegments(steps: readonly WorkoutStep[], fallback: Intensity, sport: Sport): StepSegment[] {
  const lines = stepLines({ sport, intensity: fallback, steps }, null);
  return steps.map((step, index) => {
    const line = lines[index];
    const label = line ? [line.amount, line.label, line.zone].filter(Boolean).join(' · ') : stepLabel(step);
    return {
      key: `${index}-${step.kind}`,
      intensity: line?.intensity ?? (step.intensity ?? (step.kind === 'work' ? fallback : 'recovery')),
      weight: stepWeight(step),
      label,
    };
  });
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

/** Editor stepper increment: half minutes up to 2' (strides, short reps), whole minutes above. */
export function stepMinutesIncrement(value: number): number {
  return value <= 2 ? 0.5 : 1;
}

/** Keeps edited step durations on that grid (0.5 … 2 in halves, then whole minutes). */
export function snapStepMinutes(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value < 2 ? Math.max(0.5, Math.round(value * 2) / 2) : Math.round(value);
}
