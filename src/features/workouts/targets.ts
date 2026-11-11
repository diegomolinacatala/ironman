/**
 * Pure helpers that turn the athlete's zones (domain/zones, domain/prescription)
 * into workout UI: the main target tile, the compact card caption, the plan-vs-real
 * rows of a completed session, its source label and the "No es mi día" confirm text.
 */
import { formatDistance, formatDuration } from '@/domain/dates';
import { intensityLabel } from '@/domain/labels';
import type { StepLine } from '@/domain/prescription';
import type { Intensity, NumberRange, Sport, Thresholds, Workout, WorkoutPatch } from '@/domain/types';
import {
  formatHrRange,
  mainTargets,
  sessionHrRange,
  sessionRpe,
  targetParts,
  thresholdHr,
  zoneName,
  zoneSportOf,
  type SessionShape,
  type ZoneOptions,
} from '@/domain/zones';

import { feelLabel } from './feel';
import { rpeLabel } from './rpe';

export interface TargetTile {
  label: string;
  /** Primary target as the athlete reads it: "162–168 ppm", "220–245 W", "RPE 6–7". */
  value: string;
  /** Main set + zone and the other targets ("3×8' Z4 · 4:27–4:44 /km · RPE 7–8"). */
  hint: string | null;
  /** Intensity of the main set (colour dot). */
  intensity: Intensity;
}

interface MainTarget {
  intensity: Intensity;
  /** "3×8' Z4", "Z2" or "" (strength, mobility, other). */
  head: string;
  /** "Z4", "Carrera" or "" when the sport has no zones. */
  zone: string;
  /** Targets in coach order, "aprox." on an estimated heart rate. */
  parts: string[];
}

function hasZones(sport: Sport, leg?: 'bike' | 'run' | null): boolean {
  const zs = zoneSportOf(sport, leg);
  return zs === 'run' || zs === 'bike' || zs === 'swim';
}

function markEstimated(parts: string[], hr: NumberRange | null, estimated: boolean): string[] {
  if (!hr || !estimated) return parts;
  const text = formatHrRange(hr);
  return parts.map((p) => (p === text ? `${p} aprox.` : p));
}

function mainTarget(workout: SessionShape, thresholds: Thresholds | null | undefined, opts: ZoneOptions): MainTarget {
  const { set, targets } = mainTargets(workout, thresholds, opts);
  const leg = set?.step.leg ?? null;
  const intensity = set?.intensity ?? workout.intensity;
  const zone = hasZones(workout.sport, leg) ? zoneName(intensity) : '';
  return {
    intensity,
    head: [set?.label ?? '', zone].filter(Boolean).join(' '),
    zone,
    parts: markEstimated(targetParts(targets, workout.sport, leg), targets.hr, targets.hrEstimated),
  };
}

/** Metric-grid tile of the main set (or of the whole session without steps); null for rest days. */
export function mainTargetTile(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): TargetTile | null {
  if (workout.sport === 'rest') return null;
  const { head, parts, intensity } = mainTarget(workout, thresholds, opts);
  const [primary, ...rest] = parts;
  if (!primary) return null;
  const hint = [head, ...rest].filter(Boolean).join(' · ');
  const label = primary.startsWith('RPE') ? 'Esfuerzo objetivo' : 'Zona objetivo';
  return { label, value: primary, hint: hint || null, intensity };
}

/** Compact caption for session cards: zone + main target ("Z4 · 162–168 ppm"); null for rest days. */
export function cardTargetCaption(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): string | null {
  if (workout.sport === 'rest') return null;
  const { zone, parts } = mainTarget(workout, thresholds, opts);
  const caption = [zone, parts[0] ?? ''].filter(Boolean).join(' · ');
  return caption || null;
}

/** "Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8" for one structured step. */
export function stepTargetCaption(line: Pick<StepLine, 'zone' | 'targets'>): string {
  return [line.zone, ...line.targets].filter(Boolean).join(' · ');
}

/** Heart-rate sports (run, bike, brick) show ppm only once the athlete sets an LTHR or a max HR. */
export function needsHrHint(workout: Pick<Workout, 'sport'>, thresholds?: Thresholds | null): boolean {
  const zs = zoneSportOf(workout.sport);
  return (zs === 'run' || zs === 'bike') && thresholdHr('run', thresholds) === null;
}

// ---------------------------------------------------------------------------
// Completed sessions
// ---------------------------------------------------------------------------

const PREFIX_LABELS: readonly (readonly [string, string])[] = [
  ['coros:', 'Desde COROS'],
  ['garmin:', 'Desde Garmin'],
  ['healthkit:', 'Desde Apple Salud'],
];

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  healthkit: 'Desde Apple Salud',
  garmin: 'Desde Garmin',
  coros: 'Desde COROS',
  claude: 'Desde Claude',
  manual: 'Registrado a mano',
};

/** Where the "hecho" data came from: the imported activity id wins over the writer (Claude logs COROS data). */
export function completedSourceLabel(workout: Pick<Workout, 'externalId' | 'completed'>): string | null {
  const ids = [workout.externalId, workout.completed?.externalId].filter((id): id is string => typeof id === 'string');
  const byPrefix = PREFIX_LABELS.find(([prefix]) => ids.some((id) => id.startsWith(prefix)));
  if (byPrefix) return byPrefix[1];
  const source = workout.completed?.source;
  return source ? (SOURCE_LABELS[source] ?? null) : null;
}

export interface CompareRow {
  label: string;
  /** Planned value ('' when the plan has none). */
  plan: string;
  real: string;
}

function rangeText(r: NumberRange): string {
  return r.min === r.max ? String(r.min) : `${r.min}–${r.max}`;
}

function distanceRow(w: Workout): CompareRow | null {
  const real = w.completed?.distanceM;
  if (w.distanceM == null && real == null) return null;
  return {
    label: 'Distancia',
    plan: w.distanceM != null ? formatDistance(w.distanceM, w.sport) : '—',
    real: real != null ? formatDistance(real, w.sport) : '—',
  };
}

function hrRow(w: Workout, thresholds: Thresholds | null | undefined, opts: ZoneOptions): CompareRow | null {
  const avgHr = w.completed?.avgHr;
  if (avgHr == null) return null;
  const plan = sessionHrRange(w, thresholds, opts);
  const approx = thresholdHr('run', thresholds)?.estimated ? ' aprox.' : '';
  return { label: 'FC media', plan: plan ? `${formatHrRange(plan)}${approx}` : '', real: `${Math.round(avgHr)} ppm` };
}

function rpeRow(w: Workout, opts: ZoneOptions): CompareRow | null {
  const rpe = w.completed?.rpe;
  if (rpe == null) return null;
  return { label: 'RPE', plan: rangeText(sessionRpe(w, opts)), real: `${rpe} · ${rpeLabel(rpe)}` };
}

/** Plan vs real of a completed session: duration, distance, average HR, RPE and sensations. */
export function planVsRealRows(workout: Workout, thresholds?: Thresholds | null, opts: ZoneOptions = {}): CompareRow[] {
  const done = workout.completed ?? {};
  const rows: (CompareRow | null)[] = [
    {
      label: 'Duración',
      plan: formatDuration(workout.durationMin),
      real: done.durationMin != null ? formatDuration(done.durationMin) : '—',
    },
    distanceRow(workout),
    hrRow(workout, thresholds, opts),
    rpeRow(workout, opts),
    done.feel != null ? { label: 'Sensaciones', plan: '', real: feelLabel(done.feel) } : null,
  ];
  return rows.filter((r): r is CompareRow => r !== null);
}

// ---------------------------------------------------------------------------
// "No es mi día"
// ---------------------------------------------------------------------------

/** Confirm text: the coach's plan B (if any) and what the session becomes. */
export function easierMessage(workout: Pick<Workout, 'title' | 'sport' | 'durationMin' | 'intensity' | 'coaching'>, patch: WorkoutPatch): string {
  const sport = patch.sport ?? workout.sport;
  const result =
    sport === 'rest'
      ? 'Quedará como descanso.'
      : `Quedará así: ${patch.title ?? workout.title} · ${formatDuration(patch.durationMin ?? workout.durationMin)} · ${intensityLabel(
          patch.intensity ?? workout.intensity,
        )}.`;
  const planB = workout.coaching?.planB?.trim();
  return planB ? `${planB}\n\n${result}` : result;
}
