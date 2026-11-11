/**
 * Lenient reading of what the coach attaches to each change: the session
 * structure (`steps`) and its prescription (`objective`, `keys`, `success`,
 * `planB`), plus the optional schedule fields open models often get slightly
 * wrong. A bad step or field is dropped and texts are clipped to the contract
 * maxima, so one mistake never discards the whole change. Pure.
 */
import { COACHING_LIMITS, DATE_PATTERN } from '../planning/changes.ts';
import { INTENSITIES, SPORTS, STEP_KINDS } from '../types.ts';
import type { Intensity, WorkoutCoaching, WorkoutStep, WorkoutStepKind } from '../types.ts';

/** One step as the coach's structured output carries it (every key present, nullable). */
export interface FlatStep {
  kind: WorkoutStepKind;
  durationMin: number | null;
  distanceM: number | null;
  repeat: number | null;
  intensity: Intensity | null;
  cue: string | null;
  /** Brick leg of the step (optional in older outputs). */
  leg?: 'bike' | 'run' | null;
}

export const MAX_COACH_STEPS = 30;
const STEP_MAX_MINUTES = 720;
const STEP_MAX_METERS = 100_000;
const MAX_REPEAT = 50;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;
const REASON_MAX = 300;
const DEFAULT_REASON = 'Ajuste del entrenador';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Single-line text clipped to `max` characters ("…" when cut); null when empty or not text. */
export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function positive(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function flatStep(raw: unknown): FlatStep | null {
  if (!isObj(raw) || typeof raw.kind !== 'string' || !(STEP_KINDS as readonly string[]).includes(raw.kind)) return null;
  const minutes = positive(raw.durationMin, STEP_MAX_MINUTES);
  const meters = positive(raw.distanceM, STEP_MAX_METERS);
  if (minutes === null && meters === null) return null;
  const repeat = positive(raw.repeat, MAX_REPEAT);
  const intensity = typeof raw.intensity === 'string' && (INTENSITIES as readonly string[]).includes(raw.intensity) ? (raw.intensity as Intensity) : null;
  return {
    kind: raw.kind as WorkoutStepKind,
    durationMin: minutes === null ? null : Math.round(minutes * 100) / 100,
    distanceM: minutes === null && meters !== null ? Math.round(meters) : null,
    repeat: repeat === null ? null : Math.round(repeat),
    intensity,
    cue: clipText(raw.cue, COACHING_LIMITS.cue),
    leg: raw.leg === 'bike' || raw.leg === 'run' ? raw.leg : null,
  };
}

/** Usable steps (bad ones dropped, at most 30), or null when there are none. */
export function normalizeSteps(raw: unknown): FlatStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps = raw.map(flatStep).filter((s): s is FlatStep => s !== null).slice(0, MAX_COACH_STEPS);
  return steps.length > 0 ? steps : null;
}

/** Up to 4 keys of ≤ 160 characters; null when there are none. */
export function normalizeKeys(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const keys = raw.map((k) => clipText(k, COACHING_LIMITS.key)).filter((k): k is string => k !== null).slice(0, COACHING_LIMITS.keys);
  return keys.length > 0 ? keys : null;
}

/** HH:mm (also accepts "7:30" and "07:30:00"); null when unusable. */
function timeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!m || Number(m[1]) > 23) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function roundedOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n >= min && n <= max ? n : null;
}

const oneOrNull = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;

/**
 * The raw change with every field made safe: unusable values become null
 * ("not given"), texts are clipped, steps and prescription normalized. An
 * `add` (or `move`) missing a required field is still rejected afterwards by
 * the strict PlanChange schema; an `update` just loses that field.
 */
export function sanitizeChange(item: Obj): Obj {
  return {
    ...item,
    reason: clipText(item.reason, REASON_MAX) ?? DEFAULT_REASON,
    date: typeof item.date === 'string' && DATE_PATTERN.test(item.date.trim()) ? item.date.trim() : null,
    startTime: timeOf(item.startTime),
    sport: oneOrNull(SPORTS, item.sport),
    title: clipText(item.title, TITLE_MAX),
    description: clipText(item.description, DESCRIPTION_MAX),
    durationMin: roundedOrNull(item.durationMin, 0, STEP_MAX_MINUTES),
    distanceM: roundedOrNull(item.distanceM, 0, 1_000_000),
    intensity: oneOrNull(INTENSITIES, item.intensity),
    isKey: typeof item.isKey === 'boolean' ? item.isKey : null,
    steps: normalizeSteps(item.steps),
    objective: clipText(item.objective, COACHING_LIMITS.objective),
    keys: normalizeKeys(item.keys),
    success: clipText(item.success, COACHING_LIMITS.success),
    planB: clipText(item.planB, COACHING_LIMITS.planB),
  };
}

/** Flat steps → app WorkoutStep[] (only the defined fields). */
export function toWorkoutSteps(steps: readonly FlatStep[] | null | undefined): WorkoutStep[] | null {
  if (!steps || steps.length === 0) return null;
  return steps.map((s) => ({
    kind: s.kind,
    ...(s.durationMin !== null ? { durationMin: s.durationMin } : {}),
    ...(s.distanceM !== null ? { distanceM: s.distanceM } : {}),
    ...(s.repeat !== null && s.repeat > 1 ? { repeat: s.repeat } : {}),
    ...(s.intensity !== null ? { intensity: s.intensity } : {}),
    ...(s.cue !== null ? { cue: s.cue } : {}),
    ...(s.leg ? { leg: s.leg } : {}),
  }));
}

export interface FlatPrescription {
  objective?: string | null;
  keys?: string[] | null;
  success?: string | null;
  planB?: string | null;
}

/** The prescription when it has at least an objective and a success criterion, else null (dropped). */
export function toCoaching(p: FlatPrescription): WorkoutCoaching | null {
  if (!p.objective || !p.success) return null;
  return { objective: p.objective, keys: p.keys ?? [], success: p.success, planB: p.planB ?? null };
}
