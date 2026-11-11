/**
 * Context of the morning briefing: last night's sleep, recovery signals, today's
 * sessions with their prescription (targets with the athlete's numbers, how
 * they should feel, objective, success criterion and plan B), tomorrow's in a
 * line, yesterday's with planned vs done, race countdown and the week as the
 * app shows it (phase with the week plan applied), active imprevistos, today's
 * busy blocks AS TIMES ONLY (calendar titles never leave the account) and the
 * social side (today's quedadas and pending invitations, `together.ts`).
 * Compact and in the athlete's local time.
 */
import { addDays, DEFAULT_TZ, diffDays, startOfWeek, todayIn, weekdayOf, WEEKDAYS_ES, zonedToUtc } from '../dates.ts';
import { busyView, NotFoundError } from '../planning/context.ts';
import { lifeEventLabel, raceDistanceLabel } from '../planning/labels.ts';
import { workoutLoad } from '../planning/load.ts';
import { nextRace, phaseFor } from '../planning/phase.ts';
import type { PlanningReader } from '../planning/store.ts';
import { wellnessSignals } from '../planning/wellness.ts';
import type { WellnessSignals } from '../planning/wellness.ts';
import type {
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  ISODate,
  JointSession,
  LifeEvent,
  Profile,
  Race,
  SleepSnapshot,
  UUID,
  WeekPlan,
  Workout,
} from '../types.ts';
import { todaySession, tomorrowSession, yesterdaySession } from './sessions.ts';
import type { SessionView } from './sessions.ts';
import { sleepForPrompt, sleepSnapshot } from './sleep.ts';
import { INVITE_HORIZON_DAYS, togetherForPrompt, togetherOf } from './together.ts';
import type { BriefingTogether } from './together.ts';

export type BriefingReader = Pick<
  PlanningReader,
  | 'getProfile'
  | 'listWorkouts'
  | 'listRaces'
  | 'listLifeEvents'
  | 'listBusyBlocks'
  | 'listCheckins'
  | 'listMetrics'
  | 'listJointSessions'
  | 'listWeekPlans'
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
  /** The week as the app shows it: phase ("Base 2"), week type ("Carga", "Descarga"…) and focus. */
  phase: { phase: string; label: string; weekLabel: string; focus: string };
  lifeEvents: Record<string, unknown>[];
  busyToday: { start: string; end: string }[];
  /** Today's quedadas and invitations waiting for an answer (first names, title, time, place). */
  together: BriefingTogether;
}

/** Only the first name goes to the model (enough to greet; no surnames). */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0]?.slice(0, 40) || 'atleta';
}

const byTime = (a: Workout, b: Workout): number => (a.startTime ?? '99').localeCompare(b.startTime ?? '99');

const sessionsOn = (workouts: readonly Workout[], d: ISODate): Workout[] => workouts.filter((w) => w.date === d).sort(byTime);

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

interface BriefingData {
  profile: Profile;
  tz: string;
  workouts: Workout[];
  races: Race[];
  events: LifeEvent[];
  busy: BusyBlock[];
  checkins: DailyCheckin[];
  metrics: DailyMetrics[];
  joint: JointSession[];
  weekPlans: WeekPlan[];
}

async function loadData(reader: BriefingReader, opts: BriefingContextOptions): Promise<BriefingData> {
  const profile = await reader.getProfile(opts.userId);
  if (!profile) throw new NotFoundError('No hay perfil para este usuario.');
  const tz = profile.timezone || DEFAULT_TZ;
  const { date, userId } = opts;
  const tomorrow = addDays(date, 1);
  const monday = startOfWeek(date);
  const [workouts, races, events, busy, checkins, metrics, joint, weekPlans] = await Promise.all([
    reader.listWorkouts(userId, addDays(date, -1), tomorrow),
    reader.listRaces(userId),
    reader.listLifeEvents(userId, date, date),
    reader.listBusyBlocks(userId, zonedToUtc(date, '00:00', tz), zonedToUtc(tomorrow, '00:00', tz)),
    reader.listCheckins(userId, addDays(date, -7), date),
    reader.listMetrics(userId, addDays(date, -14), date),
    reader.listJointSessions(userId, date, addDays(date, INVITE_HORIZON_DAYS - 1)),
    reader.listWeekPlans(userId, monday, monday),
  ]);
  return { profile, tz, workouts, races, events, busy, checkins, metrics, joint, weekPlans };
}

/** Phase, week type and focus with the athlete's week plan applied (the same week the app shows). */
function phaseView(data: BriefingData, date: ISODate, today: ISODate): BriefingContext['phase'] {
  const info = phaseFor(date, data.races, {
    level: data.profile.level,
    weeklyHoursTarget: data.profile.availability.weeklyHoursTarget,
    weekPlans: data.weekPlans,
    today: today <= date ? today : date,
  });
  return { phase: info.phase, label: info.label, weekLabel: info.weekLabel, focus: info.focus };
}

function yesterdayView(data: BriefingData, date: ISODate, view: SessionView): BriefingContext['yesterday'] {
  const done = sessionsOn(data.workouts, addDays(date, -1)).filter((w) => w.status === 'completed');
  return {
    sessions: done.map((w) => yesterdaySession(w, view)),
    totalMin: done.reduce((sum, w) => sum + (w.completed?.durationMin ?? w.durationMin), 0),
    load: Math.round(done.reduce((sum, w) => sum + workoutLoad(w), 0)),
  };
}

/** Throws NotFoundError when the user has no profile. */
export async function buildBriefingContext(reader: BriefingReader, opts: BriefingContextOptions): Promise<BriefingContext> {
  const data = await loadData(reader, opts);
  const { date } = opts;
  const today = todayIn(data.tz, opts.now);
  const race = nextRace(data.races, date);
  const view: SessionView = { thresholds: data.profile.thresholds, raceDistance: race?.distance ?? null };
  const sleep = sleepSnapshot(data.metrics, date);
  return {
    date,
    weekday: WEEKDAYS_ES[weekdayOf(date)],
    today,
    timezone: data.tz,
    athlete: { name: firstName(data.profile.displayName), coachNotes: data.profile.coachNotes },
    sleep,
    sleepView: sleepForPrompt(sleep, data.tz),
    recovery: wellnessSignals(data.metrics.filter((m) => m.date <= date), data.checkins),
    todayWorkouts: sessionsOn(data.workouts, date).map((w) => todaySession(w, view)),
    tomorrowWorkouts: sessionsOn(data.workouts, addDays(date, 1)).map((w) => tomorrowSession(w, view)),
    yesterday: yesterdayView(data, date, view),
    race: raceForPrompt(race, date),
    phase: phaseView(data, date, today),
    lifeEvents: data.events.filter((e) => e.startDate <= date && e.endDate >= date).map(eventForPrompt),
    busyToday: busyView(data.busy, data.tz, date, date).map(({ start, end }) => ({ start, end })),
    together: togetherOf(data.joint, opts.userId, date),
  };
}

/** The JSON sent to Claude (no ids, no calendar titles, no raw instants). */
export function promptPayload(ctx: BriefingContext): Record<string, unknown> {
  const together = togetherForPrompt(ctx.together);
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
    ...(together ? { together } : {}),
  };
}
