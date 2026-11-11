// GENERATED MIRROR of src/domain/prescription.ts — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * A session the way a coach writes it: one line per step with its zone,
 * targets (ppm, pace, watts, RPE) and sensations; a one-line target summary
 * for cards; and a plain-text prescription (objective, structure, keys,
 * success, plan B) for calendar notes and the ICS feed. Spanish copy.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs (a test fails when they drift): import only
 * zones and types here.
 */
import type { Intensity, Thresholds, WorkoutCoaching, WorkoutStepKind } from './types.ts';
import {
  formatStepAmount,
  mainTargets,
  stepIntensity,
  stepTargets,
  targetParts,
  zoneName,
  zoneSportOf,
  type SessionShape,
  type ZoneOptions,
} from './zones.ts';

export interface StepLine {
  kind: WorkoutStepKind;
  /** "10'", "3×8'", "10×100 m". */
  amount: string;
  /** "Calentamiento", "Series", "Parte principal", "Recuperación", "Vuelta a la calma", "Descanso" (+ " · bici" / " · carrera"). */
  label: string;
  intensity: Intensity;
  /** "Z2", "Z4", "Carrera"; empty for strength / mobility / other sports. */
  zone: string;
  /** Targets in the order a coach says them ("145–151 ppm", "5:08–5:48 /km", "RPE 3–4"). */
  targets: string[];
  /** The step's cue, else the zone's sensations for work steps, else null. */
  cue: string | null;
  note: string | null;
  repeat: number;
}

export interface PrescriptionInput extends SessionShape {
  coaching?: WorkoutCoaching | null;
}

function kindLabel(kind: WorkoutStepKind, repeat: number): string {
  switch (kind) {
    case 'warmup':
      return 'Calentamiento';
    case 'work':
      return repeat > 1 ? 'Series' : 'Parte principal';
    case 'recovery':
      return 'Recuperación';
    case 'cooldown':
      return 'Vuelta a la calma';
    case 'rest':
      return 'Descanso';
  }
}

function hasZones(workout: SessionShape, leg?: 'bike' | 'run' | null): boolean {
  const zs = zoneSportOf(workout.sport, leg);
  return zs === 'run' || zs === 'bike' || zs === 'swim';
}

/** One line per step, with zone, targets and how it should feel. */
export function stepLines(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): StepLine[] {
  return workout.steps.map((step) => {
    const intensity = stepIntensity(step, workout.intensity);
    const targets = stepTargets(step, workout, thresholds, opts);
    const repeat = step.repeat && step.repeat > 1 ? step.repeat : 1;
    const amount = formatStepAmount(step);
    const leg = step.leg === 'bike' ? ' · bici' : step.leg === 'run' ? ' · carrera' : '';
    return {
      kind: step.kind,
      amount: repeat > 1 && amount ? `${repeat}×${amount}` : amount,
      label: `${kindLabel(step.kind, repeat)}${leg}`,
      intensity,
      zone: hasZones(workout, step.leg) ? zoneName(intensity) : '',
      targets: targetParts(targets, workout.sport, step.leg),
      cue: step.cue?.trim() || (step.kind === 'work' ? targets.feel : null),
      note: step.note?.trim() || null,
      repeat,
    };
  });
}

/**
 * Main set and its targets in one line ("3×8' Z4 · 162–168 ppm · RPE 7–8"),
 * or null for rest days.
 */
export function targetSummary(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): string | null {
  if (workout.sport === 'rest') return null;
  const { set, targets } = mainTargets(workout, thresholds, opts);
  const leg = set?.step.leg ?? null;
  const zone = hasZones(workout, leg) ? zoneName(set?.intensity ?? workout.intensity) : '';
  const head = [set?.label ?? '', zone].filter(Boolean).join(' ');
  return [head, ...targetParts(targets, workout.sport, leg)].filter(Boolean).join(' · ');
}

/** How the main part should feel (the main set's cue, else its zone sensations). */
export function sessionFeel(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): string {
  const { set, targets } = mainTargets(workout, thresholds, opts);
  return set?.step.cue?.trim() || targets.feel;
}

function stepText(line: StepLine): string {
  const head = [line.amount, line.label.toLowerCase(), line.zone, ...line.targets].filter(Boolean).join(' · ');
  const extra = [line.cue, line.note].filter(Boolean).join(' ');
  return extra ? `• ${head}. ${extra}` : `• ${head}`;
}

/** Plain-text prescription for calendar notes and the ICS feed (no markdown). */
export function prescriptionText(workout: PrescriptionInput, thresholds?: Thresholds | null, opts: ZoneOptions = {}): string {
  const coaching = workout.coaching ?? null;
  const blocks: string[] = [];
  if (coaching?.objective) blocks.push(`Objetivo: ${coaching.objective}`);
  const lines = stepLines(workout, thresholds, opts);
  if (lines.length > 0) {
    blocks.push(['Estructura:', ...lines.map(stepText)].join('\n'));
  } else {
    const summary = targetSummary(workout, thresholds, opts);
    if (summary) blocks.push(`Intensidad: ${summary}. ${sessionFeel(workout, thresholds, opts)}`);
  }
  if (coaching && coaching.keys.length > 0) blocks.push(['Claves:', ...coaching.keys.map((k) => `• ${k}`)].join('\n'));
  const closing = [
    coaching?.success ? `Lo has hecho bien si: ${coaching.success}` : null,
    coaching?.planB ? `Si no es tu día: ${coaching.planB}` : null,
  ].filter((l): l is string => l !== null);
  if (closing.length > 0) blocks.push(closing.join('\n'));
  return blocks.join('\n\n');
}
