/**
 * Pure helpers for the proposal review screen: turns PlanChange[] into
 * human "before → after" rows (with what each new or rewritten session asks:
 * objective, targets and steps) and previews the week totals in memory.
 */
import { applyPlanChanges, describeChange } from '@/domain/changes';
import { formatDayShort, formatDistance, formatDuration, formatTime } from '@/domain/dates';
import { intensityLabel, sportLabel } from '@/domain/labels';
import { weekSummary } from '@/domain/load';
import type {
  ISODate,
  Intensity,
  ISOTime,
  PlanChange,
  Sport,
  UUID,
  Workout,
  WorkoutDraft,
} from '@/domain/types';

import { NO_PRESCRIPTION_CONTEXT, type PrescriptionContext } from './prescriptionContext';
import { notesText, sessionPreview, structureText, type SessionInput, type SessionPreview } from './sessionPreview';

export type DiffOp = PlanChange['op'];

export interface FieldDiff {
  label: string;
  before: string;
  after: string;
}

export interface DiffRow {
  index: number;
  op: DiffOp;
  opLabel: string;
  title: string;
  sport: Sport | null;
  before: string | null;
  after: string | null;
  fields: FieldDiff[];
  reason: string;
  warnings: string[];
  /** The target workout is not in the loaded week (change will likely fail). */
  missing: boolean;
  /** describeChange() text, used for accessibility. */
  description: string;
  /** What the new (or rewritten) session asks: added sessions and updates of steps/coaching. */
  session: SessionPreview | null;
}

const OP_LABEL: Record<DiffOp, string> = { add: 'Añadir', delete: 'Quitar', move: 'Mover', update: 'Ajustar' };

interface LineInput {
  date: ISODate;
  startTime?: ISOTime | null;
  sport: Sport;
  durationMin: number;
  intensity: Intensity;
}

function when(date: ISODate, startTime: ISOTime | null | undefined): string {
  const time = startTime ? formatTime(startTime) : '';
  return time ? `${formatDayShort(date)} · ${time}` : formatDayShort(date);
}

/** "mar 27 · 18:30 · Bici · 1h 30' · Fondo Z2" */
export function workoutLine(w: LineInput): string {
  return [when(w.date, w.startTime), sportLabel(w.sport), formatDuration(w.durationMin), intensityLabel(w.intensity)].join(
    ' · ',
  );
}

function distanceText(m: number | null | undefined, sport: Sport): string {
  return m != null && m > 0 ? formatDistance(m, sport) : '—';
}

type FieldSpec = {
  key: keyof WorkoutDraft;
  label: string;
  show: (target: Workout, patch: Partial<WorkoutDraft>) => [string, string];
};

/** The workout as it would be after the patch (only what a session preview reads). */
function patchedSession(target: Workout, patch: Partial<WorkoutDraft>): SessionInput {
  return {
    sport: patch.sport ?? target.sport,
    intensity: patch.intensity ?? target.intensity,
    steps: patch.steps ?? target.steps,
    coaching: patch.coaching !== undefined ? patch.coaching : (target.coaching ?? null),
  };
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { key: 'date', label: 'Día', show: (t, p) => [formatDayShort(t.date), formatDayShort(p.date ?? t.date)] },
  {
    key: 'startTime',
    label: 'Hora',
    show: (t, p) => [t.startTime ? formatTime(t.startTime) : 'Sin hora', p.startTime ? formatTime(p.startTime) : 'Sin hora'],
  },
  { key: 'sport', label: 'Deporte', show: (t, p) => [sportLabel(t.sport), sportLabel(p.sport ?? t.sport)] },
  { key: 'title', label: 'Título', show: (t, p) => [t.title, (p.title ?? t.title).trim()] },
  {
    key: 'durationMin',
    label: 'Duración',
    show: (t, p) => [formatDuration(t.durationMin), formatDuration(p.durationMin ?? t.durationMin)],
  },
  {
    key: 'intensity',
    label: 'Intensidad',
    show: (t, p) => [intensityLabel(t.intensity), intensityLabel(p.intensity ?? t.intensity)],
  },
  {
    key: 'distanceM',
    label: 'Distancia',
    show: (t, p) => [distanceText(t.distanceM, t.sport), distanceText(p.distanceM, p.sport ?? t.sport)],
  },
  { key: 'tss', label: 'Carga', show: (t, p) => [t.tss != null ? `${t.tss}` : '—', p.tss != null ? `${p.tss}` : '—'] },
  { key: 'isKey', label: 'Sesión clave', show: (t, p) => [t.isKey ? 'Sí' : 'No', p.isKey ? 'Sí' : 'No'] },
  { key: 'description', label: 'Notas', show: (t, p) => [notesText(t.description), notesText(p.description)] },
  { key: 'steps', label: 'Estructura', show: (t, p) => [structureText(t), structureText(patchedSession(t, p))] },
];

/** Only the fields whose value actually changes. */
export function updateFieldDiffs(target: Workout, patch: Partial<WorkoutDraft>): FieldDiff[] {
  const changed = (key: keyof WorkoutDraft) =>
    patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(target[key]);
  return FIELD_SPECS.filter((spec) => changed(spec.key))
    .map((spec) => {
      const [before, after] = spec.show(target, patch);
      return { label: spec.label, before, after };
    })
    .filter((f) => f.before !== f.after);
}

function warningsFor(target: Workout | undefined, jointNames: Readonly<Record<UUID, string>>): string[] {
  if (!target) return [];
  const out: string[] = [];
  if (target.jointSessionId) {
    const name = jointNames[target.jointSessionId];
    out.push(name ? `Quedada con ${name}` : 'Quedada');
  }
  if (target.isKey) out.push('Sesión clave');
  if (target.status === 'completed') out.push('Ya completado');
  return out;
}

/** Updates that rewrite what the session asks (structure or coaching) get a session preview. */
function rewritesSession(patch: Partial<WorkoutDraft>): boolean {
  return patch.steps !== undefined || patch.coaching !== undefined;
}

interface RowContext {
  workouts: readonly Workout[];
  jointNames: Readonly<Record<UUID, string>>;
  prescription: PrescriptionContext;
}

function addRow(change: Extract<PlanChange, { op: 'add' }>, index: number, ctx: RowContext): DiffRow {
  const w = change.workout;
  return {
    index,
    op: 'add',
    opLabel: OP_LABEL.add,
    reason: change.reason,
    description: describeChange(change, ctx.workouts),
    title: w.title,
    sport: w.sport,
    before: null,
    after: workoutLine(w),
    fields: [],
    warnings: [],
    missing: false,
    session: sessionPreview(w, ctx.prescription),
  };
}

function rowFor(change: PlanChange, index: number, ctx: RowContext): DiffRow {
  if (change.op === 'add') return addRow(change, index, ctx);
  const target = ctx.workouts.find((w) => w.id === change.workoutId);
  const common = {
    index,
    op: change.op,
    opLabel: OP_LABEL[change.op],
    reason: change.reason,
    description: describeChange(change, ctx.workouts),
    title: target?.title ?? 'Entreno que ya no está en tu semana',
    sport: target?.sport ?? null,
    warnings: warningsFor(target, ctx.jointNames),
    missing: !target,
    session: null,
  };
  if (change.op === 'delete') {
    return { ...common, before: target ? workoutLine(target) : null, after: 'Se quita del plan', fields: [] };
  }
  if (change.op === 'move') {
    const toTime = change.toStartTime === undefined ? (target?.startTime ?? null) : change.toStartTime;
    return {
      ...common,
      before: target ? when(target.date, target.startTime) : null,
      after: when(change.toDate, toTime),
      fields: [],
    };
  }
  const rewritten = target && rewritesSession(change.patch) ? sessionPreview(patchedSession(target, change.patch), ctx.prescription) : null;
  return {
    ...common,
    sport: change.patch.sport ?? common.sport,
    before: null,
    after: null,
    fields: target ? updateFieldDiffs(target, change.patch) : [],
    session: rewritten,
  };
}

/**
 * Diff rows of a proposal. `prescription` (thresholds + target race distance)
 * turns zones into ppm / pace / watts; without it rows still show zone and RPE.
 */
export function buildDiffRows(
  changes: readonly PlanChange[],
  workouts: readonly Workout[],
  jointNames: Readonly<Record<UUID, string>> = {},
  prescription: PrescriptionContext = NO_PRESCRIPTION_CONTEXT,
): DiffRow[] {
  const ctx: RowContext = { workouts, jointNames, prescription };
  return changes.map((change, index) => rowFor(change, index, ctx));
}

/** Indexes (into the original list) of the selected changes. */
export function selectedIndexes(selected: readonly boolean[]): number[] {
  return selected.flatMap((on, index) => (on ? [index] : []));
}

export function pickChanges(changes: readonly PlanChange[], indexes: readonly number[]): PlanChange[] {
  return indexes.flatMap((i) => (changes[i] ? [changes[i]] : []));
}

/** Maps failures reported for a subset back to original change indexes. */
export function mapFailures(
  indexes: readonly number[],
  failed: readonly { index: number; error: string }[],
): { index: number; error: string }[] {
  return failed.map((f) => ({ index: indexes[f.index] ?? f.index, error: f.error }));
}

export interface WeekTotals {
  minutes: number;
  load: number;
  sessions: number;
}

export interface PreviewResult {
  before: WeekTotals;
  after: WeekTotals;
  /** Expected failures, indexed into the ORIGINAL change list. */
  failed: { index: number; error: string }[];
}

function totals(workouts: readonly Workout[], weekStart: ISODate, today: ISODate): WeekTotals {
  const s = weekSummary([...workouts], weekStart, today);
  return { minutes: s.plannedMin, load: s.plannedTss, sessions: s.sessions };
}

/** Applies the selected changes in memory and compares the week totals. */
export function previewTotals(input: {
  workouts: readonly Workout[];
  changes: readonly PlanChange[];
  indexes: readonly number[];
  weekStart: ISODate;
  today: ISODate;
  userId: UUID;
}): PreviewResult {
  let seq = 0;
  const result = applyPlanChanges(input.workouts, pickChanges(input.changes, input.indexes), {
    userId: input.userId,
    now: new Date().toISOString(),
    newId: () => `preview-${(seq += 1)}`,
  });
  return {
    before: totals(input.workouts, input.weekStart, input.today),
    after: totals(result.workouts, input.weekStart, input.today),
    failed: mapFailures(input.indexes, result.failed),
  };
}
