/**
 * What a proposed session asks of the athlete — objective, main target and one
 * line per step with its zone and targets — plus the compact texts of the
 * "Notas" / "Estructura" diffs. Pure.
 */
import { stepLines, targetSummary, type StepLine } from '@/domain/prescription';
import type { Intensity, Sport, WorkoutCoaching, WorkoutStep } from '@/domain/types';
import type { SessionShape } from '@/domain/zones';

import type { PrescriptionContext } from './prescriptionContext';

export interface SessionPreview {
  /** Why the session is there (coaching.objective), or null. */
  objective: string | null;
  /** Main set and targets: "3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8". */
  target: string | null;
  /** One line per step (zone, targets, cue). */
  steps: StepLine[];
}

export interface SessionInput {
  sport: Sport;
  intensity: Intensity;
  steps?: readonly WorkoutStep[] | null;
  coaching?: WorkoutCoaching | null;
}

const DIFF_TEXT_MAX = 90;

function shapeOf(session: SessionInput): SessionShape {
  return { sport: session.sport, intensity: session.intensity, steps: Array.isArray(session.steps) ? session.steps : [] };
}

/** Objective, target and steps of a session (null for rest days). */
export function sessionPreview(session: SessionInput, ctx: PrescriptionContext): SessionPreview | null {
  if (session.sport === 'rest') return null;
  const shape = shapeOf(session);
  const opts = { raceDistance: ctx.raceDistance };
  return {
    objective: session.coaching?.objective?.trim() || null,
    target: targetSummary(shape, ctx.thresholds, opts) || null,
    steps: stepLines(shape, ctx.thresholds, opts),
  };
}

/** Shortens long texts for one diff line ("…" at the end). */
export function clipText(text: string, max: number = DIFF_TEXT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The notes as they read in a diff ("Sin notas" when empty). */
export function notesText(text: string | null | undefined): string {
  const clean = text?.trim();
  return clean ? clipText(clean) : 'Sin notas';
}

function legSuffix(step: WorkoutStep | undefined): string {
  if (step?.leg === 'bike') return 'bici';
  if (step?.leg === 'run') return 'carrera';
  return '';
}

function structurePart(line: StepLine, step: WorkoutStep | undefined): string {
  return [line.amount || line.label, line.kind === 'work' ? line.zone : '', legSuffix(step)].filter(Boolean).join(' ');
}

/** "15' + 3×8' Z4 + 3×3' + 10'" ("Sin estructura" without steps). */
export function structureText(session: SessionInput): string {
  const shape = shapeOf(session);
  const lines = stepLines(shape, null);
  if (lines.length === 0) return 'Sin estructura';
  return clipText(lines.map((line, i) => structurePart(line, shape.steps[i])).join(' + '));
}
