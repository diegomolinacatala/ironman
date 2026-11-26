/**
 * «Tu contexto» (`profiles.athlete_context`): what the coach knows about the
 * athlete beyond the numbers — background and goal per sport, studies/work and
 * their load, periods with less time (exams, work peaks), meal and sleep times
 * and the preferred time of day to train. Everything is optional.
 *
 * The rules planner reads the hints below (sport focus, the volume factor of a
 * heavy life, the waking day, meals, the preferred time) and the coach, the
 * briefing and Claude (get_planning_context) read the summary.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs: import only dates and types here.
 */
import { isISODate } from './dates';
import type {
  AthleteContext,
  ContextHabits,
  ContextPeriod,
  ContextSport,
  LifeLoad,
  Occupation,
  SportBackground,
  SportContext,
  SportGoal,
  TrainingTimeOfDay,
  WorkSchedule,
} from './types';

export const CONTEXT_SPORTS = ['swim', 'bike', 'run'] as const satisfies readonly ContextSport[];
export const SPORT_BACKGROUNDS = ['new', 'some', 'years', 'lifelong'] as const satisfies readonly SportBackground[];
export const SPORT_GOALS = ['maintain', 'improve', 'improve_lot'] as const satisfies readonly SportGoal[];
export const OCCUPATIONS = ['study', 'work', 'both', 'none'] as const satisfies readonly Occupation[];
export const LIFE_LOADS = ['light', 'medium', 'high'] as const satisfies readonly LifeLoad[];
export const WORK_SCHEDULES = ['morning', 'afternoon', 'full_day', 'shifts', 'flexible'] as const satisfies readonly WorkSchedule[];
export const TRAINING_TIMES = ['morning', 'midday', 'evening', 'any'] as const satisfies readonly TrainingTimeOfDay[];

/** Limits (the database checks the outline and the size; the app's zod checks these). */
export const CONTEXT_TEXT_MAX = 300;
export const CONTEXT_NOTE_MAX = 280;
export const CONTEXT_MAX_NOTES = 5;
export const CONTEXT_MAX_PERIODS = 8;
export const CONTEXT_PERIOD_LABEL_MAX = 60;
export const CONTEXT_MAX_ANSWERED = 40;

export const SPORT_BACKGROUND_LABEL: Readonly<Record<SportBackground, string>> = {
  new: 'Empiezo ahora',
  some: '1-2 años',
  years: 'Varios años',
  lifelong: 'Desde pequeño',
};

export const SPORT_GOAL_LABEL: Readonly<Record<SportGoal, string>> = {
  maintain: 'Mantener',
  improve: 'Mejorar un poco',
  improve_lot: 'Mejorar mucho',
};

export const OCCUPATION_LABEL: Readonly<Record<Occupation, string>> = {
  study: 'Estudio',
  work: 'Trabajo',
  both: 'Las dos cosas',
  none: 'Ahora ninguna',
};

export const LIFE_LOAD_LABEL: Readonly<Record<LifeLoad, string>> = { light: 'Ligera', medium: 'Media', high: 'Alta' };

export const WORK_SCHEDULE_LABEL: Readonly<Record<WorkSchedule, string>> = {
  morning: 'De mañana',
  afternoon: 'De tarde',
  full_day: 'Jornada completa o partida',
  shifts: 'Por turnos',
  flexible: 'Flexible',
};

export const TRAINING_TIME_LABEL: Readonly<Record<TrainingTimeOfDay, string>> = {
  morning: 'Por la mañana',
  midday: 'A mediodía',
  evening: 'Por la tarde-noche',
  any: 'Me da igual',
};

export const CONTEXT_SPORT_NAME: Readonly<Record<ContextSport, string>> = { swim: 'natación', bike: 'bici', run: 'carrera' };

export const EMPTY_HABITS: ContextHabits = {
  breakfast: null,
  lunch: null,
  dinner: null,
  wake: null,
  bed: null,
  weekendsDiffer: false,
  weekendWake: null,
  weekendBed: null,
  preferredTime: null,
};

export const EMPTY_ATHLETE_CONTEXT: AthleteContext = {
  sports: {},
  limitations: null,
  previousRaces: null,
  occupation: null,
  load: null,
  schedule: null,
  periods: [],
  habits: EMPTY_HABITS,
  notes: [],
  answered: [],
  completedAt: null,
  promptDismissed: false,
};

// ---------------------------------------------------------------------------
// Lenient reader
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t ? t : null;
}

/** 'HH:MM' (seconds dropped) or null. */
export function clockOf(v: unknown): string | null {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.slice(0, 5)) ? v.slice(0, 5) : null;
}

function sportContext(v: unknown): SportContext | null {
  if (!isRecord(v)) return null;
  const background = oneOf(v.background, SPORT_BACKGROUNDS);
  const goal = oneOf(v.goal, SPORT_GOALS);
  if (!background && !goal) return null;
  return { ...(background ? { background } : {}), ...(goal ? { goal } : {}) };
}

function period(v: unknown): ContextPeriod | null {
  if (!isRecord(v)) return null;
  const kind = oneOf(v.kind, ['exams', 'busy'] as const);
  if (!kind || !isISODate(v.from) || !isISODate(v.to) || v.to < v.from) return null;
  const label = text(v.label, CONTEXT_PERIOD_LABEL_MAX) ?? (kind === 'exams' ? 'Exámenes' : 'Época con menos tiempo');
  const eventId = typeof v.eventId === 'string' && v.eventId.length > 0 && v.eventId.length <= 64 ? v.eventId : null;
  return { kind, from: v.from, to: v.to, label, eventId };
}

function habits(v: unknown): ContextHabits {
  if (!isRecord(v)) return EMPTY_HABITS;
  const weekendsDiffer = v.weekendsDiffer === true;
  return {
    breakfast: clockOf(v.breakfast),
    lunch: clockOf(v.lunch),
    dinner: clockOf(v.dinner),
    wake: clockOf(v.wake),
    bed: clockOf(v.bed),
    weekendsDiffer,
    weekendWake: weekendsDiffer ? clockOf(v.weekendWake) : null,
    weekendBed: weekendsDiffer ? clockOf(v.weekendBed) : null,
    preferredTime: oneOf(v.preferredTime, TRAINING_TIMES),
  };
}

function strings(v: unknown, max: number, each: number): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => text(x, each)).filter((x): x is string => x !== null))].slice(0, max);
}

/**
 * Lenient reader for the stored jsonb (app and server): unknown keys and bad
 * values are dropped, so an old or hand-edited row never breaks the planner.
 * null when nothing is stored.
 */
export function parseAthleteContext(raw: unknown): AthleteContext | null {
  if (!isRecord(raw)) return null;
  const sportsRaw = isRecord(raw.sports) ? raw.sports : {};
  const sports: Partial<Record<ContextSport, SportContext>> = {};
  for (const sport of CONTEXT_SPORTS) {
    const s = sportContext(sportsRaw[sport]);
    if (s) sports[sport] = s;
  }
  const periods = Array.isArray(raw.periods) ? raw.periods.map(period).filter((p): p is ContextPeriod => p !== null) : [];
  return {
    sports,
    limitations: text(raw.limitations, CONTEXT_TEXT_MAX),
    previousRaces: text(raw.previousRaces, CONTEXT_TEXT_MAX),
    occupation: oneOf(raw.occupation, OCCUPATIONS),
    load: oneOf(raw.load, LIFE_LOADS),
    schedule: oneOf(raw.schedule, WORK_SCHEDULES),
    periods: periods.slice(0, CONTEXT_MAX_PERIODS),
    habits: habits(raw.habits),
    notes: strings(raw.notes, CONTEXT_MAX_NOTES, CONTEXT_NOTE_MAX),
    answered: strings(raw.answered, CONTEXT_MAX_ANSWERED, 40),
    completedAt: typeof raw.completedAt === 'string' && raw.completedAt.length <= 40 ? raw.completedAt : null,
    promptDismissed: raw.promptDismissed === true,
  };
}

/** Whether the athlete has told the coach anything that changes the plan or the coach's words. */
export function hasAthleteContext(ctx: AthleteContext | null | undefined): boolean {
  if (!ctx) return false;
  const h = ctx.habits;
  return (
    Object.keys(ctx.sports).length > 0 ||
    ctx.limitations !== null ||
    ctx.previousRaces !== null ||
    ctx.occupation !== null ||
    ctx.periods.length > 0 ||
    ctx.notes.length > 0 ||
    [h.breakfast, h.lunch, h.dinner, h.wake, h.bed, h.weekendWake, h.weekendBed, h.preferredTime].some((v) => v !== null)
  );
}

// ---------------------------------------------------------------------------
// Planner hints
// ---------------------------------------------------------------------------

/**
 * Where the week's time goes for a sport: 'less' = keep it (someone who has
 * swum for years and only wants to keep swimming: fewer sessions, a bit less
 * time), 'more' = improve it a lot (or a new swimmer: technique needs
 * frequency), null = as the plan decides.
 */
export type SportFocus = 'less' | 'more';

export function sportFocusOf(ctx: AthleteContext | null | undefined, sport: ContextSport): SportFocus | null {
  const s = ctx?.sports[sport];
  if (!s) return null;
  const experienced = s.background === 'years' || s.background === 'lifelong';
  if (s.goal === 'maintain' && experienced) return 'less';
  if (s.goal === 'improve_lot') return 'more';
  if (sport === 'swim' && s.background === 'new' && s.goal !== 'maintain') return 'more';
  return null;
}

export function sportFocus(ctx: AthleteContext | null | undefined): Partial<Record<ContextSport, SportFocus>> {
  const out: Partial<Record<ContextSport, SportFocus>> = {};
  for (const sport of CONTEXT_SPORTS) {
    const f = sportFocusOf(ctx, sport);
    if (f) out[sport] = f;
  }
  return out;
}

/** Share of the week's endurance time a sport gets with that focus (then renormalised). [H] */
export const FOCUS_SHARE: Readonly<Record<SportFocus, number>> = { less: 0.8, more: 1.2 };
/** Sessions added to / taken from the usual count with that focus (at least 1, at most 5). [H] */
export const FOCUS_SESSIONS: Readonly<Record<SportFocus, number>> = { less: -1, more: 1 };
export const FOCUS_MIN_SESSIONS = 1;
export const FOCUS_MAX_SESSIONS = 5;

export function focusedSessionCount(usual: number, focus: SportFocus | null | undefined): number {
  if (!focus || usual <= 0) return usual;
  return Math.min(FOCUS_MAX_SESSIONS, Math.max(FOCUS_MIN_SESSIONS, usual + FOCUS_SESSIONS[focus]));
}

/** Habitual-volume factor of the athlete's studies/work load (automatic availability only). [H] */
const LOAD_FACTOR: Readonly<Record<LifeLoad, number>> = { light: 1, medium: 0.95, high: 0.88 };
/** Studying and working on top: a bit less again, never below 85 %. [H] */
const BOTH_EXTRA = 0.04;
export const LIFE_LOAD_MIN_FACTOR = 0.85;

export function lifeLoadFactor(ctx: AthleteContext | null | undefined): number {
  if (!ctx || !ctx.occupation || ctx.occupation === 'none' || !ctx.load) return 1;
  const base = LOAD_FACTOR[ctx.load] - (ctx.occupation === 'both' && ctx.load !== 'light' ? BOTH_EXTRA : 0);
  return Math.max(LIFE_LOAD_MIN_FACTOR, Math.round(base * 100) / 100);
}

function minutesOf(clock: string | null): number | null {
  if (!clock) return null;
  const [h, m] = clock.split(':').map(Number);
  return h !== undefined && m !== undefined && Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function clockText(minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** No session from the start of a meal to this many minutes later (digestion). [H] */
export const MEAL_BLOCK_MIN: Readonly<Record<'breakfast' | 'lunch' | 'dinner', number>> = { breakfast: 30, lunch: 75, dinner: 75 };

/** Minute ranges (since midnight) around the usual meals, where no session starts or runs. */
export function mealRanges(ctx: AthleteContext | null | undefined): { start: number; end: number }[] {
  if (!ctx) return [];
  return (['breakfast', 'lunch', 'dinner'] as const).flatMap((meal) => {
    const start = minutesOf(ctx.habits[meal]);
    return start === null ? [] : [{ start, end: Math.min(24 * 60, start + MEAL_BLOCK_MIN[meal]) }];
  });
}

/** First session 30' after waking up; the last one done an hour before bed. [H] */
export const AFTER_WAKE_MIN = 30;
export const BEFORE_BED_MIN = 60;
const EARLIEST_START_MIN = 4 * 60 + 30;
const LATEST_START_MIN = 11 * 60;
const EARLIEST_END_MIN = 19 * 60;
const LATEST_END_MIN = 23 * 60 + 30;
const MIN_DAY_MIN = 8 * 60;

/**
 * The athlete's waking day on that weekday (0 = Monday) from their wake-up and
 * bed times (the weekend ones when weekends differ): what the planner uses
 * instead of the default 07:00–22:00 when there are no training windows.
 * null when nothing is known (the default day stays).
 */
export function wakingDayOn(ctx: AthleteContext | null | undefined, weekday: number): { start: string; end: string } | null {
  if (!ctx) return null;
  const weekend = weekday >= 5 && ctx.habits.weekendsDiffer;
  const wake = minutesOf(weekend ? (ctx.habits.weekendWake ?? ctx.habits.wake) : ctx.habits.wake);
  const bed = minutesOf(weekend ? (ctx.habits.weekendBed ?? ctx.habits.bed) : ctx.habits.bed);
  if (wake === null && bed === null) return null;
  const start = wake === null ? 7 * 60 : Math.min(LATEST_START_MIN, Math.max(EARLIEST_START_MIN, wake + AFTER_WAKE_MIN));
  // Bed after midnight (00:30) counts as the end of this day.
  const bedAbs = bed === null ? null : bed < 12 * 60 ? bed + 24 * 60 : bed;
  const end = bedAbs === null ? 22 * 60 : Math.min(LATEST_END_MIN, Math.max(EARLIEST_END_MIN, bedAbs - BEFORE_BED_MIN));
  if (end - start < MIN_DAY_MIN) return null;
  return { start: clockText(start), end: clockText(end) };
}

/** The preferred time of day to train (null / 'any' = the planner's choice). */
export function preferredTrainingTime(ctx: AthleteContext | null | undefined): Exclude<TrainingTimeOfDay, 'any'> | null {
  const t = ctx?.habits.preferredTime ?? null;
  return t === null || t === 'any' ? null : t;
}

// ---------------------------------------------------------------------------
// Words (plan note, coach, briefing)
// ---------------------------------------------------------------------------

const FOCUS_WORDS: Readonly<Record<SportFocus, string>> = { less: 'para mantener', more: 'para mejorar' };

const OCCUPATION_WORDS: Readonly<Record<Occupation, string>> = {
  study: 'estudia',
  work: 'trabaja',
  both: 'estudia y trabaja',
  none: 'ahora ni estudia ni trabaja',
};

const LOAD_SUBJECT: Readonly<Record<Occupation, string>> = { study: 'estudios', work: 'trabajo', both: 'estudios y trabajo', none: 'tu día a día' };

const BACKGROUND_WORDS:Readonly<Record<SportBackground, string>> = {
  new: 'empieza ahora',
  some: '1-2 años',
  years: 'varios años',
  lifelong: 'desde pequeño',
};

const GOAL_WORDS: Readonly<Record<SportGoal, string>> = { maintain: 'mantener', improve: 'mejorar un poco', improve_lot: 'mejorar mucho' };

const TIME_WORDS: Readonly<Record<Exclude<TrainingTimeOfDay, 'any'>, string>> = {
  morning: 'por la mañana',
  midday: 'a mediodía',
  evening: 'por la tarde-noche',
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "12 ene" from 'YYYY-MM-DD'. */
export function shortDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ''}`.trim();
}

/** "12-30 ene", "28 dic-10 ene". */
export function periodRange(p: Pick<ContextPeriod, 'from' | 'to'>): string {
  if (p.from === p.to) return shortDay(p.from);
  if (p.from.slice(0, 7) === p.to.slice(0, 7)) return `${Number(p.from.slice(8, 10))}-${shortDay(p.to)}`;
  return `${shortDay(p.from)}-${shortDay(p.to)}`;
}

/**
 * «Según tu contexto: natación para mantener, carga alta de trabajo (−12 % de
 * volumen), sin entrenar justo después de comer y mejor por la mañana.» What
 * the athlete's context changed in a planned week; null when nothing did.
 */
export function athleteContextPlanSentence(
  ctx: AthleteContext | null | undefined,
  opts: { volumeApplied: boolean; habitsApplied?: boolean },
): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  const focus = sportFocus(ctx);
  for (const sport of CONTEXT_SPORTS) {
    const f = focus[sport];
    if (f) parts.push(`${CONTEXT_SPORT_NAME[sport]} ${FOCUS_WORDS[f]}`);
  }
  const factor = lifeLoadFactor(ctx);
  if (opts.volumeApplied && factor < 1 && ctx.occupation && ctx.load) {
    parts.push(`${LOAD_SUBJECT[ctx.occupation]} con carga ${LIFE_LOAD_LABEL[ctx.load].toLowerCase()} (un ${Math.round((1 - factor) * 100)} % menos de horas por defecto)`);
  }
  const habitsApplied = opts.habitsApplied !== false;
  if (habitsApplied && mealRanges(ctx).length > 0) parts.push('sin entrenar justo después de comer');
  const time = preferredTrainingTime(ctx);
  if (habitsApplied && time) parts.push(`mejor ${TIME_WORDS[time]}`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
  return `Según tu contexto: ${list}.`;
}

/** "natación: desde pequeño, quiere mantener". */
function sportLine(sport: ContextSport, s: SportContext): string {
  const bits = [s.background ? BACKGROUND_WORDS[s.background] : null, s.goal ? `quiere ${GOAL_WORDS[s.goal]}` : null].filter(Boolean);
  return `${CONTEXT_SPORT_NAME[sport]}: ${bits.join(', ')}`;
}

function habitsLine(h: ContextHabits): string[] {
  const out: string[] = [];
  const meals = [h.breakfast ? `desayuna ${h.breakfast}` : null, h.lunch ? `come ${h.lunch}` : null, h.dinner ? `cena ${h.dinner}` : null].filter(Boolean);
  if (meals.length > 0) out.push(meals.join(', '));
  const sleep = [h.wake ? `se levanta ${h.wake}` : null, h.bed ? `se acuesta ${h.bed}` : null].filter(Boolean);
  if (sleep.length > 0) out.push(`entre semana ${sleep.join(' y ')}`);
  if (h.weekendsDiffer) {
    const weekend = [h.weekendWake ? `se levanta ${h.weekendWake}` : null, h.weekendBed ? `se acuesta ${h.weekendBed}` : null].filter(Boolean);
    out.push(weekend.length > 0 ? `el finde ${weekend.join(' y ')}` : 'el finde cambia sus horarios');
  }
  if (h.preferredTime && h.preferredTime !== 'any') out.push(`prefiere entrenar ${TIME_WORDS[h.preferredTime]}`);
  return out;
}

/**
 * One compact line for the coach, the briefing and Claude: «natación: desde
 * pequeño, quiere mantener · estudia y trabaja (carga alta, de mañana) ·
 * exámenes 12-30 ene · come 14:00, cena 21:30 · prefiere entrenar por la
 * mañana · lesiones: rodilla derecha». null when nothing is known.
 */
export function athleteContextSummary(ctx: AthleteContext | null | undefined, today?: string): string | null {
  if (!ctx || !hasAthleteContext(ctx)) return null;
  const parts: string[] = [];
  for (const sport of CONTEXT_SPORTS) {
    const s = ctx.sports[sport];
    if (s) parts.push(sportLine(sport, s));
  }
  if (ctx.occupation) {
    const extra = [ctx.load ? `carga ${LIFE_LOAD_LABEL[ctx.load].toLowerCase()}` : null, ctx.schedule ? WORK_SCHEDULE_LABEL[ctx.schedule].toLowerCase() : null].filter(Boolean);
    parts.push(`${OCCUPATION_WORDS[ctx.occupation]}${extra.length > 0 ? ` (${extra.join(', ')})` : ''}`);
  }
  for (const p of ctx.periods) {
    if (today && p.to < today) continue;
    parts.push(`${p.kind === 'exams' ? 'exámenes' : 'menos tiempo'} ${periodRange(p)}${p.label && !/^(ex[aá]menes|época con menos tiempo)$/i.test(p.label) ? ` (${p.label})` : ''}`);
  }
  parts.push(...habitsLine(ctx.habits));
  if (ctx.limitations) parts.push(`lesiones o límites: ${ctx.limitations}`);
  if (ctx.previousRaces) parts.push(`carreras previas: ${ctx.previousRaces}`);
  for (const n of ctx.notes) parts.push(n);
  return parts.join(' · ');
}
