/**
 * Stress that is costing the athlete sleep (David, 26-11-2026: "on days of high
 * stress, measured with the watch, when sleep visibly gets worse because of it,
 * the app recommends and reminds the athlete to sleep more or relax; it matters
 * most in exam periods").
 *
 * `stressSleepSignal` looks at the last three nights (the ones that end on
 * today, yesterday and the day before). A night is flagged when the day before
 * it was stressful AND the night was worse than the athlete's own baseline. Two
 * flagged nights out of three raise the signal; one bad night never does, and
 * without data it stays silent. Never a diagnosis: it only eases the plan (as a
 * proposal), reminds the athlete to go to bed earlier and offers a breathing
 * exercise. Pure and time-zone free (the caller turns `sleepStart` into local
 * minutes); mirrored to the edge functions (briefing, coach and Claude contexts)
 * by scripts/sync-domain-mirror.mjs.
 *
 * Thresholds [E] = limited evidence, [H] = coaching heuristic (docs/research/02 §0):
 * - Baseline: the MEDIAN of the nights/days before the three-day window, up to
 *   28 back, with at least 7 values; a metric without a baseline is not judged. [H]
 * - Stressful day: the watch's average stress (Garmin 0-100) 10 points or more
 *   over the athlete's baseline and at least 35 (without a baseline: 50 or more,
 *   Garmin's "medium" stress), a check-in stress of 4-5, or an exam that day or
 *   within the next two days (the run-up to an exam is the stressful part). [H]
 * - Worse night (any of): 45 min less sleep, a sleep score 10 points lower,
 *   20 min more awake (and at least 30), or going to bed 45 min later than
 *   usual. Stress and worry delay sleep onset and fragment sleep; short sleep
 *   in turn raises perceived exertion and the risk of illness and injury
 *   (Fullagar et al. 2015, Sports Med; Milewski et al. 2014). [E]
 * - Level: 'high' with three flagged nights, an exam period or 90 min less
 *   sleep on average; else 'moderate'. High eases three days, moderate two.
 */
import { addDays } from './dates';
import type { ISODate } from './types';

export type StressSleepLevel = 'moderate' | 'high';

/** What made the sleep worse, the most telling one first. */
export type SleepWorseKind = 'hours' | 'score' | 'awake' | 'later';

/** The metrics this module reads (app and server rows both fit). */
export interface StressSleepMetrics {
  date: ISODate;
  source: string;
  /** The watch's average stress of `date` (Garmin 0-100). */
  stressAvg?: number | null;
  /** The night that ENDS on `date`. */
  sleepHours?: number | null;
  sleepScore?: number | null;
  sleepAwakeMin?: number | null;
  /** When that night's sleep started (ISO instant). */
  sleepStart?: string | null;
}

export interface StressSleepCheckin {
  date: ISODate;
  /** 1-5; null = not answered (the scales are optional since the morning journal). */
  stress: number | null;
  sleepHours?: number | null;
}

export interface StressSleepEvent {
  kind: string;
  startDate: ISODate;
  endDate: ISODate;
}

export interface StressSleepInput {
  today: ISODate;
  /** At least the 30 days up to today (baseline + window). */
  metrics: readonly StressSleepMetrics[];
  checkins?: readonly StressSleepCheckin[];
  /** Life events around today (exams from today − 3 to today + 3). */
  lifeEvents?: readonly StressSleepEvent[];
  /**
   * Local minutes since midnight of an instant (the athlete's zone). Default:
   * the device's zone, right for the app; the server passes the profile's zone.
   */
  localMinutes?: (iso: string) => number | null;
}

export interface StressSleepNight {
  /** The night that ends on `date`. */
  date: ISODate;
  stressHigh: boolean;
  sleepWorse: boolean;
  flagged: boolean;
  /** Minutes of sleep below the baseline (positive = less sleep), null when unknown. */
  hoursDeficitMin: number | null;
  scoreDrop: number | null;
  awakeRiseMin: number | null;
  laterBedMin: number | null;
}

export interface StressSleepSignal {
  date: ISODate;
  level: StressSleepLevel;
  /** An exam today, in the last 3 days or in the next 3: the stronger version. */
  exam: boolean;
  /** Nights out of the last three where stress and worse sleep came together. */
  flaggedNights: number;
  /** Stressful days among the three that led into those nights. */
  stressDays: number;
  /** The most telling change in the sleep and its size (minutes or score points). */
  worse: { kind: SleepWorseKind; amount: number };
  /** The athlete's usual bedtime, minutes since local midnight (learned, else 23:00). */
  usualBedtimeMin: number;
  /** Days the plan is eased, from today. */
  easeDays: number;
  /** «Estrés alto 3 días y dormiste 1 h menos de lo habitual». */
  headline: string;
  /** «hoy suave y acuéstate antes». */
  advice: string;
  /** The sentence for the briefing, the coach and Claude: `${headline}: ${advice}.` */
  message: string;
  /** One reason per flagged night, with its numbers. */
  reasons: string[];
  nights: StressSleepNight[];
}

export const STRESS_SLEEP = {
  windowDays: 3,
  minFlaggedNights: 2,
  baselineMaxDays: 28,
  baselineMinValues: 7,
  stressRise: 10,
  stressFloor: 35,
  stressNoBaseline: 50,
  checkinStressMin: 4,
  examLeadDays: 2,
  examPeriodDays: 3,
  hoursDropMin: 45,
  scoreDrop: 10,
  awakeRiseMin: 20,
  awakeFloorMin: 30,
  laterBedMin: 45,
  highDeficitMin: 90,
  easeDaysModerate: 2,
  easeDaysHigh: 3,
} as const;

/** Bedtime reminder: the usual bedtime from the last nights, fired this long before it. */
export const BEDTIME = {
  historyNights: 21,
  minNights: 5,
  defaultMin: 23 * 60,
  reminderLeadMin: 45,
  /** «Acuéstate antes»: this much earlier than usual. */
  earlierMin: 30,
} as const;

/**
 * Weekly planner: extra volume factor while the signal is on, never on a
 * descarga. Exams already cut the week (restrictions.ts): there the signal
 * takes a further 10 %. [H]
 */
export const STRESS_SLEEP_WEEK_FACTOR = { moderate: 0.9, high: 0.85, examExtra: 0.9 } as const;

/** Volume factor of a planned week while the signal is on (`examWeek`: the week already has the exam cut). */
export function stressSleepWeekFactor(signal: Pick<StressSleepSignal, 'level'> | null | undefined, examWeek: boolean): number {
  if (!signal) return 1;
  if (examWeek) return STRESS_SLEEP_WEEK_FACTOR.examExtra;
  return STRESS_SLEEP_WEEK_FACTOR[signal.level];
}

/** Merge priority everywhere: Garmin > COROS > HealthKit > manual. */
const SOURCE_RANK: Readonly<Record<string, number>> = { garmin: 0, coros: 1, healthkit: 2, manual: 3 };

type Key = 'stressAvg' | 'sleepHours' | 'sleepScore' | 'sleepAwakeMin';

/** Plausible ranges (anything else is a sensor glitch). */
const RANGES: Readonly<Record<Key, readonly [number, number]>> = {
  stressAvg: [1, 100],
  sleepHours: [0.5, 16],
  sleepScore: [1, 100],
  sleepAwakeMin: [0, 600],
};

interface Day {
  stressAvg: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  sleepAwakeMin: number | null;
  sleepStart: string | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function valid(key: Key, v: unknown): number | null {
  if (!isNum(v)) return null;
  const [lo, hi] = RANGES[key];
  return v >= lo && v <= hi ? v : null;
}

/** One row per date, field by field in source order. */
function mergeDays(rows: readonly StressSleepMetrics[]): Map<ISODate, Day> {
  const rank = (s: string) => SOURCE_RANK[s] ?? 9;
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || rank(a.source) - rank(b.source));
  const out = new Map<ISODate, Day>();
  for (const r of sorted) {
    const prev = out.get(r.date);
    out.set(r.date, {
      stressAvg: prev?.stressAvg ?? valid('stressAvg', r.stressAvg),
      sleepHours: prev?.sleepHours ?? valid('sleepHours', r.sleepHours),
      sleepScore: prev?.sleepScore ?? valid('sleepScore', r.sleepScore),
      sleepAwakeMin: prev?.sleepAwakeMin ?? valid('sleepAwakeMin', r.sleepAwakeMin),
      sleepStart: prev?.sleepStart ?? (typeof r.sleepStart === 'string' && r.sleepStart ? r.sleepStart : null),
    });
  }
  return out;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Device-local minutes since midnight of an instant (the app's default). */
export function deviceLocalMinutes(iso: string): number | null {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
}

/**
 * Bedtimes on an axis that does not break at midnight: minutes after 18:00
 * (23:00 → 300, 00:30 → 390). Bedtimes from 18:00 to 06:00 only (naps and
 * night shifts are left out).
 */
function bedAxis(localMin: number | null): number | null {
  if (localMin === null || !isNum(localMin)) return null;
  const axis = (((localMin - 18 * 60) % 1440) + 1440) % 1440;
  return axis <= 12 * 60 ? axis : null;
}

function fromBedAxis(axis: number): number {
  return Math.round(axis + 18 * 60) % 1440;
}

interface Baselines {
  stress: number | null;
  hours: number | null;
  score: number | null;
  awake: number | null;
  bed: number | null;
}

function baselines(days: Map<ISODate, Day>, today: ISODate, bedOf: (d: Day) => number | null): Baselines {
  const end = addDays(today, -STRESS_SLEEP.windowDays);
  const from = addDays(end, -(STRESS_SLEEP.baselineMaxDays - 1));
  const before = [...days.entries()].filter(([date]) => date >= from && date <= end).map(([, d]) => d);
  const base = (pick: (d: Day) => number | null): number | null => {
    const values = before.map(pick).filter(isNum);
    return values.length >= STRESS_SLEEP.baselineMinValues ? median(values) : null;
  };
  return { stress: base((d) => d.stressAvg), hours: base((d) => d.sleepHours), score: base((d) => d.sleepScore), awake: base((d) => d.sleepAwakeMin), bed: base(bedOf) };
}

/** Exams on `date` or within the next `examLeadDays`. */
function examAhead(events: readonly StressSleepEvent[], date: ISODate): boolean {
  const until = addDays(date, STRESS_SLEEP.examLeadDays);
  return events.some((e) => e.kind === 'exam' && e.startDate <= until && e.endDate >= date);
}

function watchStressHigh(value: number | null, base: number | null): boolean {
  if (value === null) return false;
  if (base === null) return value >= STRESS_SLEEP.stressNoBaseline;
  return value >= Math.max(base + STRESS_SLEEP.stressRise, STRESS_SLEEP.stressFloor);
}

interface NightCtx {
  days: Map<ISODate, Day>;
  base: Baselines;
  checkins: readonly StressSleepCheckin[];
  events: readonly StressSleepEvent[];
  bedOf: (d: Day) => number | null;
}

function nightOf(date: ISODate, ctx: NightCtx): StressSleepNight {
  const dayBefore = addDays(date, -1);
  const night = ctx.days.get(date);
  const checkinStress = ctx.checkins.some((c) => (c.date === dayBefore || c.date === date) && isNum(c.stress) && c.stress >= STRESS_SLEEP.checkinStressMin);
  const stressHigh = watchStressHigh(ctx.days.get(dayBefore)?.stressAvg ?? null, ctx.base.stress) || checkinStress || examAhead(ctx.events, dayBefore);
  const manualHours = ctx.checkins.find((c) => c.date === date)?.sleepHours;
  const hours = night?.sleepHours ?? valid('sleepHours', manualHours);
  const { base } = ctx;
  const deficit = hours !== null && base.hours !== null ? Math.round((base.hours - hours) * 60) : null;
  const scoreDrop = night?.sleepScore != null && base.score !== null ? Math.round(base.score - night.sleepScore) : null;
  const awakeRise = night?.sleepAwakeMin != null && base.awake !== null ? Math.round(night.sleepAwakeMin - base.awake) : null;
  const bed = night ? ctx.bedOf(night) : null;
  const later = bed !== null && base.bed !== null ? Math.round(bed - base.bed) : null;
  const sleepWorse =
    (deficit !== null && deficit >= STRESS_SLEEP.hoursDropMin) ||
    (scoreDrop !== null && scoreDrop >= STRESS_SLEEP.scoreDrop) ||
    (awakeRise !== null && awakeRise >= STRESS_SLEEP.awakeRiseMin && (night?.sleepAwakeMin ?? 0) >= STRESS_SLEEP.awakeFloorMin) ||
    (later !== null && later >= STRESS_SLEEP.laterBedMin);
  return { date, stressHigh, sleepWorse, flagged: stressHigh && sleepWorse, hoursDeficitMin: deficit, scoreDrop, awakeRiseMin: awakeRise, laterBedMin: later };
}

const avg = (values: readonly number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** The change that explains the flagged nights best: less sleep, then the score, minutes awake, a later bedtime. */
function worseOf(flagged: readonly StressSleepNight[]): StressSleepSignal['worse'] {
  const pick = (read: (n: StressSleepNight) => number | null, min: number) => flagged.map(read).filter((v): v is number => v !== null && v >= min);
  const hours = pick((n) => n.hoursDeficitMin, STRESS_SLEEP.hoursDropMin);
  if (hours.length > 0) return { kind: 'hours', amount: avg(hours) };
  const score = pick((n) => n.scoreDrop, STRESS_SLEEP.scoreDrop);
  if (score.length > 0) return { kind: 'score', amount: avg(score) };
  const awake = pick((n) => n.awakeRiseMin, STRESS_SLEEP.awakeRiseMin);
  if (awake.length > 0) return { kind: 'awake', amount: avg(awake) };
  return { kind: 'later', amount: avg(pick((n) => n.laterBedMin, STRESS_SLEEP.laterBedMin)) };
}

/** «45 min», «1 h», «1 h 15 min» (rounded to 15 min, at least 15). */
export function roughDuration(minutes: number): string {
  const q = Math.max(15, Math.round(minutes / 15) * 15);
  const h = Math.floor(q / 60);
  const m = q % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** «dormiste 1 h menos de lo habitual», «tu sueño puntúa 12 puntos menos»… */
export function worseText(worse: StressSleepSignal['worse']): string {
  switch (worse.kind) {
    case 'hours':
      return `dormiste ${roughDuration(worse.amount)} menos de lo habitual`;
    case 'score':
      return `tu sueño puntúa ${worse.amount} puntos menos de lo habitual`;
    case 'awake':
      return `pasas ${roughDuration(worse.amount)} más despierto por la noche`;
    default:
      return `te acuestas ${roughDuration(worse.amount)} más tarde de lo habitual`;
  }
}

function headlineOf(stressDays: number, exam: boolean, worse: StressSleepSignal['worse']): string {
  const stress = exam ? `Exámenes y estrés alto ${stressDays} días` : `Estrés alto ${stressDays} días`;
  return `${stress} y ${worseText(worse)}`;
}

function reasonOf(n: StressSleepNight): string {
  const parts = [
    n.hoursDeficitMin !== null && n.hoursDeficitMin >= STRESS_SLEEP.hoursDropMin ? `${roughDuration(n.hoursDeficitMin)} menos de sueño` : null,
    n.scoreDrop !== null && n.scoreDrop >= STRESS_SLEEP.scoreDrop ? `puntuación ${n.scoreDrop} puntos por debajo` : null,
    n.awakeRiseMin !== null && n.awakeRiseMin >= STRESS_SLEEP.awakeRiseMin ? `${n.awakeRiseMin} min más despierto` : null,
    n.laterBedMin !== null && n.laterBedMin >= STRESS_SLEEP.laterBedMin ? `a la cama ${roughDuration(n.laterBedMin)} más tarde` : null,
  ].filter((p): p is string => p !== null);
  return `Noche del ${n.date}: estrés alto el día antes y ${parts.join(', ')}`;
}

/** The athlete's usual bedtime (median of the last nights, minutes since local midnight), else 23:00. */
export function usualBedtime(input: Pick<StressSleepInput, 'today' | 'metrics' | 'localMinutes'>): number {
  const local = input.localMinutes ?? deviceLocalMinutes;
  const from = addDays(input.today, -BEDTIME.historyNights);
  const days = mergeDays(input.metrics.filter((m) => m.date >= from && m.date <= input.today));
  const beds = [...days.values()].map((d) => bedAxis(d.sleepStart ? local(d.sleepStart) : null)).filter(isNum);
  const mid = beds.length >= BEDTIME.minNights ? median(beds) : null;
  return mid === null ? BEDTIME.defaultMin : fromBedAxis(mid);
}

/**
 * The signal of `today`, or null: fewer than 2 of the last 3 nights with
 * stress and worse sleep together, or not enough data to tell.
 */
export function stressSleepSignal(input: StressSleepInput): StressSleepSignal | null {
  const { today } = input;
  const local = input.localMinutes ?? deviceLocalMinutes;
  const bedOf = (d: Day) => bedAxis(d.sleepStart ? local(d.sleepStart) : null);
  const days = mergeDays(input.metrics.filter((m) => m.date <= today));
  const events = input.lifeEvents ?? [];
  const ctx: NightCtx = { days, base: baselines(days, today, bedOf), checkins: input.checkins ?? [], events, bedOf };
  const nights = Array.from({ length: STRESS_SLEEP.windowDays }, (_, i) => nightOf(addDays(today, i - (STRESS_SLEEP.windowDays - 1)), ctx));
  const flagged = nights.filter((n) => n.flagged);
  if (flagged.length < STRESS_SLEEP.minFlaggedNights) return null;
  const periodFrom = addDays(today, -STRESS_SLEEP.examPeriodDays);
  const periodTo = addDays(today, STRESS_SLEEP.examPeriodDays);
  const exam = events.some((e) => e.kind === 'exam' && e.startDate <= periodTo && e.endDate >= periodFrom);
  const worse = worseOf(flagged);
  const high = exam || flagged.length === STRESS_SLEEP.windowDays || (worse.kind === 'hours' && worse.amount >= STRESS_SLEEP.highDeficitMin);
  const level: StressSleepLevel = high ? 'high' : 'moderate';
  const stressDays = nights.filter((n) => n.stressHigh).length;
  const headline = headlineOf(stressDays, exam, worse);
  const advice = high ? 'hoy suave, acuéstate antes y regálate unos minutos de respiración lenta' : 'hoy suave y acuéstate antes';
  return {
    date: today,
    level,
    exam,
    flaggedNights: flagged.length,
    stressDays,
    worse,
    usualBedtimeMin: usualBedtime(input),
    easeDays: high ? STRESS_SLEEP.easeDaysHigh : STRESS_SLEEP.easeDaysModerate,
    headline,
    advice,
    message: `${headline}: ${advice}.`,
    reasons: flagged.map(reasonOf),
    nights,
  };
}

/** «22:30»: minutes since midnight as a clock time. */
export function clockOf(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The bedtime the reminder suggests: 30 min before the usual one. */
export function suggestedBedtime(signal: Pick<StressSleepSignal, 'usualBedtimeMin'>): number {
  return (signal.usualBedtimeMin - BEDTIME.earlierMin + 1440) % 1440;
}
