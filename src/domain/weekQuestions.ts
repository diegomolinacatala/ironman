/**
 * The Sunday and Wednesday questions (Tú › Ajustes › Preguntas de la semana, off by default;
 * pure, app only). Asked on Hoy, answered in one or two taps, stored in
 * `profiles.week_questions`:
 *
 * - Sunday («Tu semana», also Monday while unanswered), about the week that starts on the next
 *   Monday: priority (con gente / cuando mejor me vaya / un poco de todo), how busy it is
 *   (muchas cosas / normal / más libre) and, optionally, «¿Qué planes tienes?».
 * - Wednesday («Tu fin de semana», also Thursday), only with a second place in «Mis sitios»:
 *   «¿Este fin de semana vuelves a {away}?» and, when the road bike is there and not at home,
 *   «¿Quieres salir en bici?» → «¿Con quién?» (prefills a quedada, never sends it).
 *
 * How the answers change the plan: `weekContext.ts` (volume, shorter sessions, the place of
 * each day) and `weekSocial.ts` (friends' common slots).
 */
import { addDays, isISODate, startOfWeek, weekdayOf } from './dates';
import type { ISODate, Profile, WeekAnswers, WeekLoad, WeekPriority, WeekQuestions } from './types';

export const WEEK_PRIORITIES: readonly WeekPriority[] = ['together', 'mix', 'flexible'];
export const WEEK_LOADS: readonly WeekLoad[] = ['busy', 'normal', 'free'];
/** Weeks of answers kept on the profile (the current one, the next one and a little history). */
export const WEEK_ANSWERS_KEPT = 4;
export const PLANS_MAX = 280;

export const PRIORITY_LABELS: Readonly<Record<WeekPriority, string>> = {
  together: 'Entrenar con gente',
  mix: 'Un poco de todo',
  flexible: 'Cuando mejor me vaya',
};

export const LOAD_LABELS: Readonly<Record<WeekLoad, string>> = {
  busy: 'Muchas cosas',
  normal: 'Normal',
  free: 'Más libre',
};

/** Volume of a «más libre» week before the ramp caps (they still apply). [H] */
export const FREE_WEEK_FACTOR = 1.1;
/** Volume of a «muchas cosas» week (like a work peak, severity 1–2). [H] */
export const BUSY_WEEK_FACTOR = 0.8;
/** Longest weekday session in a «muchas cosas» week (the weekend keeps the long ones). [H] */
export const BUSY_WEEKDAY_MAX_MIN = 75;

export const EMPTY_WEEK_QUESTIONS: WeekQuestions = { enabled: false, weeks: [] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function parseAnswers(raw: unknown): WeekAnswers | null {
  if (!isRecord(raw) || typeof raw.weekStart !== 'string' || !isISODate(raw.weekStart)) return null;
  const plans = typeof raw.plans === 'string' && raw.plans.trim() ? raw.plans.trim().slice(0, PLANS_MAX) : undefined;
  return defined<WeekAnswers>({
    weekStart: startOfWeek(raw.weekStart),
    priority: oneOf(raw.priority, WEEK_PRIORITIES),
    load: oneOf(raw.load, WEEK_LOADS),
    plans,
    sundayDone: bool(raw.sundayDone),
    awayWeekend: bool(raw.awayWeekend),
    awayRide: bool(raw.awayRide),
    wednesdayDone: bool(raw.wednesdayDone),
  });
}

/** `profiles.week_questions` → WeekQuestions; null when nothing usable is stored (off). Odd entries are dropped. */
export function parseWeekQuestions(raw: unknown): WeekQuestions | null {
  if (!isRecord(raw)) return null;
  const weeks = (Array.isArray(raw.weeks) ? raw.weeks : []).map(parseAnswers).filter((w): w is WeekAnswers => w !== null);
  const unique = weeks.filter((w, i) => weeks.findIndex((x) => x.weekStart === w.weekStart) === i);
  return { enabled: raw.enabled === true, weeks: unique.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, WEEK_ANSWERS_KEPT) };
}

/** The questions are on for this athlete. */
export function weekQuestionsOn(profile: Pick<Profile, 'weekQuestions'> | null | undefined): boolean {
  return profile?.weekQuestions?.enabled === true;
}

/** Answers for the week of `weekStart` (only while the questions are on). */
export function answersFor(profile: Pick<Profile, 'weekQuestions'> | null | undefined, weekStart: ISODate): WeekAnswers | null {
  if (!weekQuestionsOn(profile)) return null;
  const monday = startOfWeek(weekStart);
  return profile?.weekQuestions?.weeks.find((w) => w.weekStart === monday) ?? null;
}

/** The stored questions with `patch` merged into the answers of `weekStart` (newest first, trimmed). */
export function withAnswers(current: WeekQuestions | null | undefined, weekStart: ISODate, patch: Partial<Omit<WeekAnswers, 'weekStart'>>): WeekQuestions {
  const base = current ?? EMPTY_WEEK_QUESTIONS;
  const monday = startOfWeek(weekStart);
  const previous = base.weeks.find((w) => w.weekStart === monday) ?? { weekStart: monday };
  const merged = defined<WeekAnswers>({ ...previous, ...patch, weekStart: monday });
  const weeks = [merged, ...base.weeks.filter((w) => w.weekStart !== monday)]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, WEEK_ANSWERS_KEPT);
  return { enabled: base.enabled, weeks };
}

export type WeekQuestionKind = 'sunday' | 'wednesday';

export interface DueQuestion {
  kind: WeekQuestionKind;
  /** Monday of the week the question is about. */
  weekStart: ISODate;
}

/** The road bike is at the other place and not at home: on a weekend there, ask about riding outside. */
export function asksAboutRide(profile: Pick<Profile, 'places'>): boolean {
  const places = profile.places;
  return Boolean(places?.away?.gear.roadBike && !places.home.gear.roadBike);
}

/**
 * The question Hoy shows today, if any: Sunday (or Monday while unanswered) → «Tu semana»
 * for the week of the next Monday (Monday: this week); Wednesday or Thursday → «Tu fin de
 * semana» for this week, only with a second place. One at a time; answered or dismissed = gone.
 */
export function dueQuestion(profile: Pick<Profile, 'weekQuestions' | 'places'> | null | undefined, today: ISODate): DueQuestion | null {
  if (!profile || !weekQuestionsOn(profile)) return null;
  const weekday = weekdayOf(today);
  if (weekday === 6 || weekday === 0) {
    const weekStart = weekday === 6 ? addDays(today, 1) : today;
    return answersFor(profile, weekStart)?.sundayDone ? null : { kind: 'sunday', weekStart };
  }
  if ((weekday === 2 || weekday === 3) && profile.places?.away) {
    const weekStart = startOfWeek(today);
    return answersFor(profile, weekStart)?.wednesdayDone ? null : { kind: 'wednesday', weekStart };
  }
  return null;
}

/** Saturday and Sunday of the week of `weekStart`: the days spent at the other place on a weekend away. */
export function weekendOf(weekStart: ISODate): ISODate[] {
  const monday = startOfWeek(weekStart);
  return [addDays(monday, 5), addDays(monday, 6)];
}

/** «Más libre» lifts the week's volume (`FREE_WEEK_FACTOR`, before the ramp caps); 1 otherwise. */
export function weekVolumeBoost(profile: Pick<Profile, 'weekQuestions'> | null | undefined, weekStart: ISODate): number {
  return answersFor(profile, weekStart)?.load === 'free' ? FREE_WEEK_FACTOR : 1;
}
