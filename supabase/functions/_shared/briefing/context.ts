/**
 * Context of the morning briefing: last night's sleep, recovery signals, today's
 * and tomorrow's workouts (with structure), yesterday's sessions, race countdown
 * and phase, active imprevistos and today's busy blocks AS TIMES ONLY (calendar
 * titles never leave the account). Compact and in the athlete's local time.
 */
import { addDays, DEFAULT_TZ, diffDays, todayIn, weekdayOf, WEEKDAYS_ES, zonedToUtc } from '../dates.ts';
import { busyView, NotFoundError } from '../planning/context.ts';
import { intensityLabel, lifeEventLabel, raceDistanceLabel, sportLabel } from '../planning/labels.ts';
import { workoutLoad } from '../planning/load.ts';
import { nextRace, phaseFor } from '../planning/phase.ts';
import type { PlanningReader } from '../planning/store.ts';
import { wellnessSignals } from '../planning/wellness.ts';
import type { WellnessSignals } from '../planning/wellness.ts';
import type { ISODate, LifeEvent, Race, SleepSnapshot, UUID, Workout } from '../types.ts';
import { sleepForPrompt, sleepSnapshot } from './sleep.ts';

export type BriefingReader = Pick<
  PlanningReader,
  'getProfile' | 'listWorkouts' | 'listRaces' | 'listLifeEvents' | 'listBusyBlocks' | 'listCheckins' | 'listMetrics'
>;

export interface BriefingContext {
  date: ISODate;
  weekday: string;
  /** The athlete's "today" (the app may ask for tomorrow's briefing the evening before). */
  today: ISODate;
  timezone: string;
  athlete: { name: string; coachNotes: string | null };
  /** Exact snapshot stored with the briefing and returned to the app. */
  sleep: SleepSnapshot | null;
  /** Prompt view of `sleep` (local times, duration text, HRV vs baseline %). */
  sleepView: Record<string, unknown> | null;
  recovery: WellnessSignals;
  todayWorkouts: Record<string, unknown>[];
  tomorrowWorkouts: Record<string, unknown>[];
  yesterday: { sessions: Record<string, unknown>[]; totalMin: number; load: number };
  race: Record<string, unknown> | null;
  phase: { phase: string; label: string; focus: string };
  lifeEvents: Record<string, unknown>[];
  busyToday: { start: string; end: string }[];
}

/** Only the first name goes to the model (enough to greet; no surnames). */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0]?.slice(0, 40) || 'atleta';
}

const byTime = (a: Workout, b: Workout): number => (a.startTime ?? '99').localeCompare(b.startTime ?? '99');

function workoutForPrompt(w: Workout): Record<string, unknown> {
  const c = w.completed;
  return {
    title: w.title,
    sport: sportLabel(w.sport),
    startTime: w.startTime,
    durationMin: w.durationMin,
    distanceM: w.distanceM,
    intensity: intensityLabel(w.intensity),
    isKey: w.isKey,
    status: w.status,
    ...(w.description ? { description: w.description } : {}),
    ...(w.steps.length ? { steps: w.steps.map((s) => ({ ...s, ...(s.intensity ? { intensity: intensityLabel(s.intensity) } : {}) })) } : {}),
    ...(c ? { done: { durationMin: c.durationMin, distanceM: c.distanceM, avgHr: c.avgHr, rpe: c.rpe } } : {}),
  };
}

function raceForPrompt(race: Race | null, date: ISODate): Record<string, unknown> | null {
  if (!race) return null;
  return { name: race.name, date: race.date, distance: raceDistanceLabel(race.distance), priority: race.priority, daysToRace: diffDays(race.date, date) };
}

function eventForPrompt(e: LifeEvent): Record<string, unknown> {
  return { kind: lifeEventLabel(e.kind), title: e.title, until: e.endDate, severity: e.severity, bodyArea: e.bodyArea };
}

export interface BriefingContextOptions {
  userId: UUID;
  date: ISODate;
  now: Date;
}

/** Throws NotFoundError when the user has no profile. */
export async function buildBriefingContext(reader: BriefingReader, opts: BriefingContextOptions): Promise<BriefingContext> {
  const profile = await reader.getProfile(opts.userId);
  if (!profile) throw new NotFoundError('No hay perfil para este usuario.');
  const tz = profile.timezone || DEFAULT_TZ;
  const { date, userId } = opts;
  const yesterday = addDays(date, -1);
  const tomorrow = addDays(date, 1);
  const [workouts, races, events, busy, checkins, metrics] = await Promise.all([
    reader.listWorkouts(userId, yesterday, tomorrow),
    reader.listRaces(userId),
    reader.listLifeEvents(userId, date, date),
    reader.listBusyBlocks(userId, zonedToUtc(date, '00:00', tz), zonedToUtc(tomorrow, '00:00', tz)),
    reader.listCheckins(userId, addDays(date, -7), date),
    reader.listMetrics(userId, addDays(date, -14), date),
  ]);
  const on = (d: ISODate): Workout[] => workouts.filter((w) => w.date === d).sort(byTime);
  const done = on(yesterday).filter((w) => w.status === 'completed');
  const sleep = sleepSnapshot(metrics, date);
  const phase = phaseFor(date, races);
  return {
    date,
    weekday: WEEKDAYS_ES[weekdayOf(date)],
    today: todayIn(tz, opts.now),
    timezone: tz,
    athlete: { name: firstName(profile.displayName), coachNotes: profile.coachNotes },
    sleep,
    sleepView: sleepForPrompt(sleep, tz),
    recovery: wellnessSignals(metrics.filter((m) => m.date <= date), checkins),
    todayWorkouts: on(date).map(workoutForPrompt),
    tomorrowWorkouts: on(tomorrow).map(workoutForPrompt),
    yesterday: {
      sessions: done.map(workoutForPrompt),
      totalMin: done.reduce((sum, w) => sum + (w.completed?.durationMin ?? w.durationMin), 0),
      load: Math.round(done.reduce((sum, w) => sum + workoutLoad(w), 0)),
    },
    race: raceForPrompt(nextRace(races, date), date),
    phase: { phase: phase.phase, label: phase.label, focus: phase.focus },
    lifeEvents: events.filter((e) => e.startDate <= date && e.endDate >= date).map(eventForPrompt),
    busyToday: busyView(busy, tz, date, date).map(({ start, end }) => ({ start, end })),
  };
}

/** The JSON sent to Claude (no ids, no calendar titles, no raw instants). */
export function promptPayload(ctx: BriefingContext): Record<string, unknown> {
  return {
    date: ctx.date,
    weekday: ctx.weekday,
    isToday: ctx.date === ctx.today,
    athlete: ctx.athlete,
    sleepLastNight: ctx.sleepView,
    recovery: { level: ctx.recovery.level, signals: ctx.recovery.signals },
    today: ctx.todayWorkouts,
    tomorrow: ctx.tomorrowWorkouts,
    yesterday: ctx.yesterday,
    race: ctx.race,
    phase: ctx.phase,
    activeImprevistos: ctx.lifeEvents,
    busyToday: ctx.busyToday,
  };
}
