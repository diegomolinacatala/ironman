/**
 * Week-level plans ("Plan → General": carga, más volumen, descarga, semana
 * libre) written from the server: suggested by the AI coach (stored in
 * `coach_jobs.extras.weekPlans`, saved by the app on the athlete's tap) or set
 * by Claude (`set_week_plans`, saved directly with source 'claude'). Same
 * checks as the app repository: a Monday from this week on, a known kind,
 * minutes 0–3000, note ≤ 300; plus a week the periodization lets the athlete
 * adjust (taper, race and post-race weeks always follow the plan). Pure.
 */
import { addDays, isIsoDate, startOfWeek, weekdayOf } from '../dates.ts';
import type { Result } from '../schema.ts';
import { WEEK_PLAN_KINDS } from '../types.ts';
import type { ISODate, Race, WeekPlanDraft, WeekPlanKind, WeekPlanSource } from '../types.ts';
import { phaseFor as domainPhaseFor } from './domain/periodization.ts';
import { canOverride } from './domain/season.ts';
import { athleteLevel } from './phase.ts';

export const WEEK_PLAN_LIMITS = { minutesMax: 3000, noteMax: 300 } as const;
/** How far ahead the AI coach may suggest week plans (Claude: 52, the app's limit). */
export const COACH_WEEK_PLAN_WEEKS = 26;
export const CLAUDE_WEEK_PLAN_WEEKS = 52;

/** One week as the coach output and the MCP tool name it (snake_case, untrusted). */
export interface RawWeekPlan {
  week_start?: unknown;
  kind?: unknown;
  target_minutes?: unknown;
  note?: unknown;
}

export interface WeekPlanCheck {
  /** The athlete's today (local). */
  today: ISODate;
  /** Last allowed Monday: this week + `maxWeeks` weeks. */
  maxWeeks: number;
  races: readonly Race[];
  level?: string | null;
  source: WeekPlanSource;
}

const fail = (error: string): Result<WeekPlanDraft> => ({ ok: false, error });

/** The Monday, or a Spanish reason why it cannot carry a week plan. */
export function checkWeekStart(value: unknown, check: Pick<WeekPlanCheck, 'today' | 'maxWeeks'>): Result<ISODate> {
  if (typeof value !== 'string' || !isIsoDate(value)) return { ok: false, error: `la fecha ${String(value)} no es una fecha real (YYYY-MM-DD)` };
  if (weekdayOf(value) !== 0) return { ok: false, error: `${value} no es lunes (usa ${startOfWeek(value)})` };
  const first = startOfWeek(check.today);
  const last = addDays(first, 7 * check.maxWeeks);
  if (value < first) return { ok: false, error: `la semana del ${value} ya ha pasado (esta semana empieza el ${first})` };
  if (value > last) return { ok: false, error: `la semana del ${value} está a más de ${check.maxWeeks} semanas (último lunes: ${last})` };
  return { ok: true, value };
}

const PHASE_WORDS: Readonly<Record<string, string>> = {
  peak: 'es de pico',
  taper: 'es de afinamiento',
  race_week: 'es de carrera',
  recovery: 'es de recuperación tras una carrera',
  transition: 'es de transición',
};

/** Null when the periodization lets this week be adjusted, else the Spanish reason. */
export function fixedWeekReason(weekStart: ISODate, races: readonly Race[], level?: string | null): string | null {
  const info = domainPhaseFor(weekStart, races, { level: athleteLevel(level) });
  if (canOverride(info)) return null;
  const what = info.raceInWeek ? 'tiene carrera' : (PHASE_WORDS[info.phase] ?? 'es fija');
  return `la semana del ${weekStart} ${what}: sigue la periodización y no admite ajuste`;
}

function minutesOf(value: unknown): Result<number | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'target_minutes debe ser un número de minutos o null' };
  const minutes = Math.round(value);
  if (minutes < 0 || minutes > WEEK_PLAN_LIMITS.minutesMax) return { ok: false, error: `target_minutes debe estar entre 0 y ${WEEK_PLAN_LIMITS.minutesMax}` };
  return { ok: true, value: minutes };
}

function noteOf(value: unknown): Result<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'note debe ser un texto o null' };
  const note = value.replace(/\s+/g, ' ').trim();
  if (note.length > WEEK_PLAN_LIMITS.noteMax) return { ok: false, error: `note: máximo ${WEEK_PLAN_LIMITS.noteMax} caracteres` };
  return { ok: true, value: note || null };
}

/** One raw week → a draft ready to save, or the Spanish reason it is not valid. */
export function checkWeekPlan(raw: RawWeekPlan, check: WeekPlanCheck): Result<WeekPlanDraft> {
  const weekStart = checkWeekStart(raw.week_start, check);
  if (!weekStart.ok) return fail(weekStart.error);
  if (typeof raw.kind !== 'string' || !(WEEK_PLAN_KINDS as readonly string[]).includes(raw.kind)) {
    return fail(`kind de la semana del ${weekStart.value} debe ser uno de: ${WEEK_PLAN_KINDS.join(', ')}`);
  }
  const minutes = minutesOf(raw.target_minutes);
  if (!minutes.ok) return fail(`semana del ${weekStart.value}: ${minutes.error}`);
  const note = noteOf(raw.note);
  if (!note.ok) return fail(`semana del ${weekStart.value}: ${note.error}`);
  const fixed = fixedWeekReason(weekStart.value, check.races, check.level);
  if (fixed) return fail(fixed);
  return {
    ok: true,
    value: { weekStart: weekStart.value, kind: raw.kind as WeekPlanKind, targetMinutes: minutes.value, note: note.value, source: check.source },
  };
}

export interface WeekPlansResult {
  valid: WeekPlanDraft[];
  issues: string[];
}

/** Every week checked; a repeated Monday keeps the first one and reports the rest. */
export function checkWeekPlans(raws: readonly RawWeekPlan[], check: WeekPlanCheck): WeekPlansResult {
  const valid: WeekPlanDraft[] = [];
  const issues: string[] = [];
  for (const raw of raws) {
    const parsed = checkWeekPlan(raw, check);
    if (!parsed.ok) issues.push(parsed.error);
    else if (valid.some((d) => d.weekStart === parsed.value.weekStart)) issues.push(`la semana del ${parsed.value.weekStart} está repetida`);
    else valid.push(parsed.value);
  }
  return { valid, issues };
}
