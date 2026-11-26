/**
 * Imported training plans (a coach's PDF, a photo, pasted text, Excel/CSV or a
 * TrainingPeaks calendar feed). Every source is turned into one normalized
 * `ImportedPlan` (weeks × weekdays, sessions with sport, duration, distance,
 * intensity, optional steps), reviewed by the athlete and then written as
 * planned workouts with `source: 'imported'` and the import id.
 *
 * Imported weeks are the athlete's base: the weekly planner adds nothing on
 * top of them (`isImportedWeek`), while the re-planner still moves or eases
 * imported sessions for life events, readiness, weather… as proposals.
 * Intensities use the app's zones (Z1–Z5 + race pace), so targets and the
 * coach's numbers come from `domain/zones.ts` like any other session.
 */
import { addDays, diffDays, isISODate, startOfWeek, weekdayOf } from './dates';
import { intensityZone, sportLabel } from './labels';
import { INTENSITIES, SPORTS } from './types';
import type { Intensity, ISODate, ISODateTime, ISOTime, Sport, UUID, Weekday, Workout, WorkoutDraft, WorkoutStep } from './types';

export const PLAN_IMPORT_SOURCES = ['pdf', 'photo', 'text', 'csv', 'xlsx', 'trainingpeaks'] as const;
export type PlanImportSource = (typeof PLAN_IMPORT_SOURCES)[number];

export const IMPORT_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ImportConfidence = (typeof IMPORT_CONFIDENCES)[number];

/** Limits shared by the parsers, the review screen and the database. */
export const IMPORT_LIMITS = {
  sessions: 400,
  weeks: 60,
  title: 120,
  description: 1000,
  durationMax: 720,
  distanceMax: 1_000_000,
  steps: 50,
} as const;

export interface ImportedSession {
  /** Stable key inside the plan (review list, edits). */
  key: string;
  /** 1-based week of the plan. */
  week: number;
  /** 0 = Monday … 6 = Sunday. */
  day: Weekday;
  /** The date written in the source (calendar feeds, dated spreadsheets), if any. */
  sourceDate: ISODate | null;
  startTime: ISOTime | null;
  sport: Sport;
  title: string;
  durationMin: number;
  distanceM: number | null;
  intensity: Intensity;
  steps: WorkoutStep[];
  description: string | null;
  /** How sure the parser is about this session (low → highlighted in the review). */
  confidence: ImportConfidence;
}

export interface ImportedPlan {
  source: PlanImportSource;
  title: string;
  sessions: ImportedSession[];
  /** Overall confidence (worst of the sessions, softened by their share). */
  confidence: ImportConfidence;
  /** Monday of week 1 according to the source (dated sources), else null. */
  sourceStart: ISODate | null;
  /** Spanish notes for the review ("3 filas sin deporte reconocido"). */
  warnings: string[];
  /** Who read it: deterministic parser or the AI. */
  engine: 'rules' | 'ai';
}

/** A stored import (Tú › Importar un plan › Planes importados). */
export interface PlanImport {
  id: UUID;
  source: PlanImportSource;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  sessionCount: number;
  confidence: ImportConfidence;
  createdAt: ISODateTime;
}

export interface PlanImportDraft {
  source: PlanImportSource;
  title: string;
  confidence: ImportConfidence;
  /** The reviewed plan (kept for reference / re-alignment). */
  plan: ImportedPlan;
  /** Planned workouts to create (source 'imported'). */
  workouts: WorkoutDraft[];
  /** Replace the sessions the app planned itself (rules / AI / Claude) in the imported weeks. */
  replaceGenerated: boolean;
}

export interface PlanImportResult {
  import: PlanImport;
  added: number;
  /** App-generated planned sessions removed from the imported weeks. */
  replaced: number;
}

/** What the AI parse needs (photo, PDF or pasted text). */
export type PlanParseInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; imageBase64: string }
  | { kind: 'pdf'; pdfBase64: string };

export const PLAN_TEXT_MAX = 20_000;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < min || n > max ? null : n;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Rough minutes from a distance when the source only gave kilometres / metres. */
export function minutesFromDistance(sport: Sport, distanceM: number): number {
  const perKm: Partial<Record<Sport, number>> = { run: 6, bike: 2.2, swim: 22, brick: 3 };
  return Math.round((distanceM / 1000) * (perKm[sport] ?? 6));
}

const DEFAULT_MINUTES: Record<Sport, number> = {
  swim: 45,
  bike: 60,
  run: 45,
  brick: 75,
  strength: 40,
  mobility: 20,
  other: 45,
  rest: 0,
};

/** "Rodaje · Z2" style default title. */
export function defaultSessionTitle(sport: Sport, intensity: Intensity): string {
  if (sport === 'rest') return 'Descanso';
  if (sport === 'strength' || sport === 'mobility') return sportLabel(sport);
  return `${sportLabel(sport)} ${intensityZone(intensity)}`;
}

function cleanSteps(raw: unknown): WorkoutStep[] {
  if (!Array.isArray(raw)) return [];
  const kinds = ['warmup', 'work', 'recovery', 'cooldown', 'rest'] as const;
  const steps: WorkoutStep[] = [];
  for (const item of raw.slice(0, IMPORT_LIMITS.steps)) {
    if (!isObj(item)) continue;
    const kind = kinds.find((k) => k === item.kind) ?? 'work';
    const durationMin = clampInt(item.durationMin, 1, IMPORT_LIMITS.durationMax);
    const distanceM = clampInt(item.distanceM, 1, IMPORT_LIMITS.distanceMax);
    if (durationMin === null && distanceM === null) continue;
    const intensity = INTENSITIES.find((i) => i === item.intensity);
    const repeat = clampInt(item.repeat, 2, 50);
    const note = cleanText(item.note, 200);
    steps.push({
      kind,
      ...(durationMin !== null ? { durationMin } : {}),
      ...(distanceM !== null ? { distanceM } : {}),
      ...(intensity ? { intensity } : {}),
      ...(repeat !== null ? { repeat } : {}),
      ...(note ? { note } : {}),
    });
  }
  return steps;
}

/** Total minutes of a step list (repeats included). */
export function stepsMinutes(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

/**
 * Any loosely shaped session (AI JSON, parser output, edited row) → a valid
 * ImportedSession, or null when it is unusable (no week/day/date).
 */
export function normalizeSession(raw: unknown, key: string, sourceStart: ISODate | null = null): ImportedSession | null {
  if (!isObj(raw)) return null;
  const sport: Sport = SPORTS.find((s) => s === raw.sport) ?? 'other';
  const intensity: Intensity = INTENSITIES.find((i) => i === raw.intensity) ?? (sport === 'rest' ? 'recovery' : 'endurance');
  const sourceDate = typeof raw.sourceDate === 'string' && isISODate(raw.sourceDate) ? raw.sourceDate : null;
  let week = clampInt(raw.week, 1, IMPORT_LIMITS.weeks);
  let day = clampInt(raw.day, 0, 6) as Weekday | null;
  if (sourceDate && sourceStart) {
    week = Math.floor(diffDays(startOfWeek(sourceDate), sourceStart) / 7) + 1;
    day = weekdayOf(sourceDate);
    if (week < 1 || week > IMPORT_LIMITS.weeks) return null;
  }
  if (week === null || day === null) return null;
  const steps = cleanSteps(raw.steps);
  const distanceM = clampInt(raw.distanceM, 1, IMPORT_LIMITS.distanceMax);
  const explicitMin = clampInt(raw.durationMin, 0, IMPORT_LIMITS.durationMax);
  const fromSteps = stepsMinutes(steps);
  const durationMin =
    explicitMin && explicitMin > 0
      ? explicitMin
      : fromSteps > 0
        ? Math.min(fromSteps, IMPORT_LIMITS.durationMax)
        : distanceM
          ? Math.min(minutesFromDistance(sport, distanceM), IMPORT_LIMITS.durationMax)
          : DEFAULT_MINUTES[sport];
  const guessedDuration = !(explicitMin && explicitMin > 0) && fromSteps === 0 && !distanceM;
  const rawConfidence = IMPORT_CONFIDENCES.find((c) => c === raw.confidence);
  const confidence: ImportConfidence =
    sport === 'other' || guessedDuration ? 'low' : rawConfidence ?? 'medium';
  const startTime = typeof raw.startTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.startTime) ? raw.startTime : null;
  return {
    key,
    week,
    day,
    sourceDate,
    startTime,
    sport,
    title: cleanText(raw.title, IMPORT_LIMITS.title) ?? defaultSessionTitle(sport, intensity),
    durationMin,
    distanceM,
    intensity,
    steps,
    description: cleanText(raw.description, IMPORT_LIMITS.description),
    confidence,
  };
}

/** Overall confidence: low when ≥ 25 % of the sessions are low (or nothing was read), high only when all are high. */
export function planConfidence(sessions: readonly ImportedSession[]): ImportConfidence {
  if (sessions.length === 0) return 'low';
  const low = sessions.filter((s) => s.confidence === 'low').length;
  if (low / sessions.length >= 0.25) return 'low';
  return sessions.every((s) => s.confidence === 'high') ? 'high' : 'medium';
}

function bySchedule(a: ImportedSession, b: ImportedSession): number {
  return a.week - b.week || a.day - b.day || (a.startTime ?? '99').localeCompare(b.startTime ?? '99');
}

/** Builds a plan from session-like objects (drops unusable ones, sorts, caps, sets confidence). */
export function buildPlan(input: {
  source: PlanImportSource;
  title?: string | null;
  sessions: readonly unknown[];
  sourceStart?: ISODate | null;
  warnings?: readonly string[];
  engine: 'rules' | 'ai';
  confidence?: ImportConfidence | null;
}): ImportedPlan {
  const sourceStart = input.sourceStart ? startOfWeek(input.sourceStart) : null;
  const warnings = [...(input.warnings ?? [])];
  const sessions = input.sessions
    .map((s, i) => normalizeSession(s, `s${i + 1}`, sourceStart))
    .filter((s): s is ImportedSession => s !== null)
    // Rest days are not sessions: the planner leaves empty days alone.
    .filter((s) => s.sport !== 'rest')
    .sort(bySchedule);
  const dropped = input.sessions.length - sessions.length;
  if (sessions.length > IMPORT_LIMITS.sessions) warnings.push(`Solo se importan las primeras ${IMPORT_LIMITS.sessions} sesiones.`);
  const kept = sessions.slice(0, IMPORT_LIMITS.sessions);
  const computed = planConfidence(kept);
  // The AI's own doubt only lowers the confidence, never raises it.
  const order: ImportConfidence[] = ['low', 'medium', 'high'];
  const confidence = input.confidence && order.indexOf(input.confidence) < order.indexOf(computed) ? input.confidence : computed;
  return {
    source: input.source,
    title: cleanText(input.title, IMPORT_LIMITS.title) ?? DEFAULT_TITLES[input.source],
    sessions: kept,
    confidence,
    sourceStart,
    warnings: dropped > 0 && kept.length > 0 ? [...warnings, droppedWarning(dropped)] : warnings,
    engine: input.engine,
  };
}

function droppedWarning(n: number): string {
  return n === 1 ? 'Una línea no parecía una sesión (o era descanso) y no se ha importado.' : `${n} líneas no parecían sesiones (o eran descanso) y no se han importado.`;
}

const DEFAULT_TITLES: Record<PlanImportSource, string> = {
  pdf: 'Plan del PDF',
  photo: 'Plan de la foto',
  text: 'Plan pegado',
  csv: 'Plan de la hoja de cálculo',
  xlsx: 'Plan del Excel',
  trainingpeaks: 'Calendario de TrainingPeaks',
};

export function planImportSourceLabel(source: PlanImportSource): string {
  const labels: Record<PlanImportSource, string> = {
    pdf: 'PDF',
    photo: 'Foto',
    text: 'Texto',
    csv: 'CSV',
    xlsx: 'Excel',
    trainingpeaks: 'TrainingPeaks',
  };
  return labels[source];
}

// ---------------------------------------------------------------------------
// Review edits
// ---------------------------------------------------------------------------

export function updateSession(plan: ImportedPlan, key: string, patch: Partial<Omit<ImportedSession, 'key'>>): ImportedPlan {
  const sessions = plan.sessions
    .map((s) => (s.key === key ? { ...s, ...patch, confidence: patch.confidence ?? (s.confidence === 'low' ? 'medium' : s.confidence) } : s))
    .sort(bySchedule);
  return { ...plan, sessions, confidence: planConfidence(sessions) };
}

export function removeSession(plan: ImportedPlan, key: string): ImportedPlan {
  const sessions = plan.sessions.filter((s) => s.key !== key);
  return { ...plan, sessions, confidence: planConfidence(sessions) };
}

export function planWeeks(plan: ImportedPlan): number {
  return plan.sessions.reduce((max, s) => Math.max(max, s.week), 0);
}

/** Sessions grouped by week (review screen). */
export function sessionsByWeek(plan: ImportedPlan): { week: number; sessions: ImportedSession[]; minutes: number }[] {
  const weeks = new Map<number, ImportedSession[]>();
  for (const s of plan.sessions) weeks.set(s.week, [...(weeks.get(s.week) ?? []), s]);
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, sessions]) => ({ week, sessions, minutes: sessions.reduce((sum, s) => sum + s.durationMin, 0) }));
}

// ---------------------------------------------------------------------------
// Scheduling ("semana 1" → a Monday) and workouts
// ---------------------------------------------------------------------------

/** Default Monday of week 1: the source's own start, else this Monday (next one from Thursday on). */
export function defaultStartMonday(plan: ImportedPlan, today: ISODate): ISODate {
  if (plan.sourceStart) return plan.sourceStart;
  const monday = startOfWeek(today);
  return weekdayOf(today) >= 3 ? addDays(monday, 7) : monday;
}

export function sessionDate(session: ImportedSession, startMonday: ISODate): ISODate {
  return addDays(startOfWeek(startMonday), (session.week - 1) * 7 + session.day);
}

/** Planned workouts for the reviewed plan. Sessions before `today` are skipped (counted in `skipped`). */
export function importToWorkouts(plan: ImportedPlan, startMonday: ISODate, today: ISODate): { workouts: WorkoutDraft[]; skipped: number } {
  const workouts: WorkoutDraft[] = [];
  let skipped = 0;
  for (const s of plan.sessions) {
    const date = sessionDate(s, startMonday);
    if (date < today) {
      skipped += 1;
      continue;
    }
    workouts.push({
      date,
      startTime: s.startTime,
      sport: s.sport,
      title: s.title,
      description: s.description,
      durationMin: s.durationMin,
      distanceM: s.distanceM,
      intensity: s.intensity,
      steps: s.steps,
      isKey: false,
      source: 'imported',
    });
  }
  return { workouts, skipped };
}

export function draftForImport(plan: ImportedPlan, startMonday: ISODate, today: ISODate, replaceGenerated = true): PlanImportDraft {
  return {
    source: plan.source,
    title: plan.title,
    confidence: plan.confidence,
    plan,
    workouts: importToWorkouts(plan, startMonday, today).workouts,
    replaceGenerated,
  };
}

// ---------------------------------------------------------------------------
// Planner guard: imported weeks are the athlete's base
// ---------------------------------------------------------------------------

/** Sources of sessions the app planned itself (replaced when an imported plan takes over a week). */
export const GENERATED_SOURCES = ['rules', 'ai_coach', 'claude'] as const;

/** Mondays of the weeks that hold a (not skipped) imported session. */
export function importedWeekStarts(workouts: readonly Pick<Workout, 'date' | 'source' | 'status'>[]): Set<ISODate> {
  return new Set(workouts.filter((w) => w.source === 'imported' && w.status !== 'skipped').map((w) => startOfWeek(w.date)));
}

export function isImportedWeek(workouts: readonly Pick<Workout, 'date' | 'source' | 'status'>[], weekStart: ISODate): boolean {
  return importedWeekStarts(workouts).has(startOfWeek(weekStart));
}

export const IMPORTED_WEEK_SUMMARY =
  'Esta semana sigue el plan que importaste: no añado sesiones por encima. Si cambia algo (un imprevisto, el tiempo, cómo te encuentras), te propongo ajustes sobre ese plan.';
