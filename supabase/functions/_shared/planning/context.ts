/**
 * The single "planning context" used by both the MCP tool
 * `get_planning_context` and the in-app AI coach: everything needed to plan or
 * re-plan a week, compact, camelCase, ids included, Spanish labels.
 */
import { addDays, DEFAULT_TZ, localParts, startOfWeek, todayIn, weekdayOf, WEEKDAYS_ES, zonedToUtc } from '../dates.ts';
import type {
  Availability,
  BusyBlock,
  ISODate,
  JointSession,
  LifeEvent,
  Profile,
  Race,
  UUID,
  Workout,
} from '../types.ts';
import { intensityLabel, lifeEventLabel, raceDistanceLabel, sportLabel } from './labels.ts';
import { weeklyLoadHistory, weekTotals, workoutLoad } from './load.ts';
import type { WeeklyLoad, WeekTotals } from './load.ts';
import { phaseFor } from './phase.ts';
import type { PhaseInfo } from './phase.ts';
import type { PlanningReader } from './store.ts';
import { mergeMetricsByDate, wellnessSignals } from './wellness.ts';
import type { WellnessSignals } from './wellness.ts';

export type Detail = 'concise' | 'detailed';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface ContextOptions {
  userId: UUID;
  /** Any date of the target week (normalized to Monday). Defaults to the current week. */
  weekStart?: ISODate;
  now: Date;
  detail: Detail;
  /** Include the following week too (coach, replans near the weekend). */
  includeNextWeek?: boolean;
}

export interface WorkoutView {
  id: UUID;
  date: ISODate;
  weekday: string;
  startTime: string | null;
  sport: Workout['sport'];
  sportLabel: string;
  title: string;
  durationMin: number;
  distanceM: number | null;
  intensity: Workout['intensity'];
  intensityLabel: string;
  status: Workout['status'];
  isKey: boolean;
  jointSessionId: UUID | null;
  partners?: string[];
  load: number;
  completed?: Record<string, unknown>;
  description?: string | null;
  steps?: Workout['steps'];
}

export interface BusyView {
  date: ISODate;
  start: string;
  end: string;
}

export interface PlanningContext {
  generatedAt: string;
  timezone: string;
  today: ISODate;
  todayWeekday: string;
  weekStart: ISODate;
  weekEnd: ISODate;
  units: string;
  athlete: Record<string, unknown>;
  phase: PhaseInfo;
  races: Record<string, unknown>[];
  week: { totals: WeekTotals; workouts: WorkoutView[] };
  nextWeek?: { weekStart: ISODate; totals: WeekTotals; workouts: WorkoutView[] };
  jointSessions: Record<string, unknown>[];
  lifeEvents: Record<string, unknown>[];
  /** Busy intervals only: event titles never leave the account (they are not sent to any AI). */
  busy: BusyView[];
  wellness: { readiness: WellnessSignals; checkins: Record<string, unknown>[]; metrics: Record<string, unknown>[] };
  loadHistory: WeeklyLoad[];
  recentSessions?: WorkoutView[];
  nutrition?: Record<string, unknown>[];
  friends: { friendId: UUID; name: string; username: string }[];
  notes: string[];
}

const UNITS =
  'Fechas YYYY-MM-DD y horas HH:mm en hora local (zona del atleta, normalmente Europe/Madrid). Duraciones en minutos, distancias en metros, carga en puntos (100 ≈ 1 h a umbral). Días: lunes…domingo.';

const dayName = (date: ISODate): string => WEEKDAYS_ES[weekdayOf(date)];
const dayNames = (days: readonly number[]): string[] => days.map((d) => WEEKDAYS_ES[d] ?? String(d));

function availabilityView(a: Availability): Record<string, unknown> {
  return {
    weeklyHoursTarget: a.weeklyHoursTarget,
    restDay: a.restDay == null ? null : WEEKDAYS_ES[a.restDay],
    longSessionDays: dayNames(a.longSessionDays),
    poolDays: a.poolDays.length ? dayNames(a.poolDays) : 'cualquier día',
    windows: a.windows.map((w) => ({ day: WEEKDAYS_ES[w.weekday], start: w.start, end: w.end })),
  };
}

function athleteView(p: Profile): Record<string, unknown> {
  return {
    name: p.displayName,
    username: p.username,
    level: p.level,
    sports: p.sports,
    thresholds: p.thresholds,
    availability: availabilityView(p.availability),
    coachNotes: p.coachNotes,
  };
}

function partnersFor(w: Workout, sessions: readonly JointSession[], userId: UUID): string[] | undefined {
  if (!w.jointSessionId) return undefined;
  const session = sessions.find((s) => s.id === w.jointSessionId);
  if (!session) return undefined;
  return session.participants.filter((p) => p.userId !== userId && p.status !== 'declined').map((p) => p.displayName);
}

export function workoutView(w: Workout, detail: Detail, sessions: readonly JointSession[], userId: UUID): WorkoutView {
  const partners = partnersFor(w, sessions, userId);
  const c = w.completed;
  return {
    id: w.id,
    date: w.date,
    weekday: dayName(w.date),
    startTime: w.startTime,
    sport: w.sport,
    sportLabel: sportLabel(w.sport),
    title: w.title,
    durationMin: w.durationMin,
    distanceM: w.distanceM,
    intensity: w.intensity,
    intensityLabel: intensityLabel(w.intensity),
    status: w.status,
    isKey: w.isKey,
    jointSessionId: w.jointSessionId,
    ...(partners && partners.length ? { partners } : {}),
    load: workoutLoad(w),
    ...(c
      ? { completed: { durationMin: c.durationMin, distanceM: c.distanceM, avgHr: c.avgHr, rpe: c.rpe, tss: c.tss, source: c.source } }
      : {}),
    ...(detail === 'detailed' ? { description: w.description, steps: w.steps } : {}),
  };
}

function inRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to;
}

function lifeEventView(e: LifeEvent): Record<string, unknown> {
  return {
    id: e.id,
    kind: e.kind,
    kindLabel: lifeEventLabel(e.kind),
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime,
    durationMin: e.durationMin,
    severity: e.severity,
    bodyArea: e.bodyArea,
    notes: e.notes,
  };
}

function raceView(r: Race, today: ISODate): Record<string, unknown> {
  const days = Math.round((Date.parse(r.date) - Date.parse(today)) / 86_400_000);
  return { ...r, distanceLabel: raceDistanceLabel(r.distance), daysToRace: days };
}

/** Local busy intervals. The block title is deliberately dropped (privacy: only start/end are shared). */
export function busyView(blocks: readonly BusyBlock[], tz: string, from: ISODate, to: ISODate): BusyView[] {
  return blocks
    .map((b): BusyView => {
      const start = localParts(b.start, tz);
      const end = localParts(b.end, tz);
      return { date: start.date, start: start.time, end: end.date === start.date ? end.time : '23:59' };
    })
    .filter((b) => inRange(b.date, from, to))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function jointView(s: JointSession, userId: UUID): Record<string, unknown> {
  const mine = s.participants.find((p) => p.userId === userId);
  return {
    id: s.id,
    date: s.date,
    startTime: s.startTime,
    sport: s.sport,
    title: s.title,
    durationMin: s.durationMin,
    status: s.status,
    location: s.location,
    myStatus: mine?.status ?? (s.organizerId === userId ? 'accepted' : null),
    myWorkoutId: mine?.workoutId ?? null,
    partners: s.participants.filter((p) => p.userId !== userId).map((p) => ({ name: p.displayName, status: p.status })),
  };
}

interface RawContext {
  profile: Profile;
  tz: string;
  today: ISODate;
  weekStart: ISODate;
  windowEnd: ISODate;
  workouts: Workout[];
  races: Race[];
  events: LifeEvent[];
  busy: BusyBlock[];
  checkins: Awaited<ReturnType<PlanningReader['listCheckins']>>;
  metrics: Awaited<ReturnType<PlanningReader['listMetrics']>>;
  nutrition: Awaited<ReturnType<PlanningReader['listNutrition']>>;
  joint: JointSession[];
  friends: Awaited<ReturnType<PlanningReader['listFriends']>>;
}

async function loadRaw(reader: PlanningReader, opts: ContextOptions): Promise<RawContext> {
  const profile = await reader.getProfile(opts.userId);
  if (!profile) throw new NotFoundError('No hay perfil para este usuario. Completa el registro en la app.');
  const tz = profile.timezone || DEFAULT_TZ;
  const today = todayIn(tz, opts.now);
  const weekStart = startOfWeek(opts.weekStart ?? today);
  const windowEnd = addDays(weekStart, opts.includeNextWeek ? 13 : 6);
  const historyFrom = addDays(weekStart < today ? weekStart : today, -42);
  const [workouts, races, events, busy, checkins, metrics, nutrition, joint, friends] = await Promise.all([
    reader.listWorkouts(opts.userId, historyFrom, windowEnd),
    reader.listRaces(opts.userId),
    reader.listLifeEvents(opts.userId, historyFrom, windowEnd),
    reader.listBusyBlocks(opts.userId, zonedToUtc(weekStart, '00:00', tz), zonedToUtc(addDays(windowEnd, 1), '00:00', tz)),
    reader.listCheckins(opts.userId, addDays(today, -13), today),
    reader.listMetrics(opts.userId, addDays(today, -13), today),
    opts.detail === 'detailed' ? reader.listNutrition(opts.userId, addDays(today, -2), today) : Promise.resolve([]),
    reader.listJointSessions(opts.userId, weekStart, windowEnd),
    reader.listFriends(opts.userId),
  ]);
  return { profile, tz, today, weekStart, windowEnd, workouts, races, events, busy, checkins, metrics, nutrition, joint, friends };
}

function weekBlock(raw: RawContext, from: ISODate, to: ISODate, detail: Detail): { totals: WeekTotals; workouts: WorkoutView[] } {
  const list = raw.workouts
    .filter((w) => inRange(w.date, from, to))
    .sort((a, b) => (a.date + (a.startTime ?? '99')).localeCompare(b.date + (b.startTime ?? '99')));
  return { totals: weekTotals(list), workouts: list.map((w) => workoutView(w, detail, raw.joint, raw.profile.id)) };
}

function wellnessBlock(raw: RawContext, detail: Detail): PlanningContext['wellness'] {
  const days = detail === 'detailed' ? 14 : 7;
  const since = addDays(raw.today, -(days - 1));
  const metrics = mergeMetricsByDate(raw.metrics).filter((m) => m.date >= since);
  return {
    readiness: wellnessSignals(raw.metrics, raw.checkins),
    checkins: raw.checkins.filter((c) => c.date >= since).map((c) => ({ ...c })),
    metrics: metrics.map((m) => ({ ...m })),
  };
}

const NOTES = [
  'Los cambios se proponen con propose_plan_changes y el atleta los acepta en la app (salvo apply_now).',
  'Las quedadas (jointSessionId / partners) son compromisos con otra persona: muévelas solo si es imprescindible y explica por qué.',
  'Las sesiones isKey=true son las clave de la semana: protégelas y ajusta antes las accesorias.',
  'Los datos de Garmin guardados aquí pueden ir con retraso respecto al conector de Garmin del usuario.',
  'Ante dolor, lesión o enfermedad: prioriza la seguridad y recomienda consultar a un profesional sanitario.',
];

/** Builds the planning context. Throws NotFoundError when the user has no profile. */
export async function buildPlanningContext(reader: PlanningReader, opts: ContextOptions): Promise<PlanningContext> {
  const raw = await loadRaw(reader, opts);
  const weekEnd = addDays(raw.weekStart, 6);
  const eventsFrom = addDays(raw.weekStart < raw.today ? raw.weekStart : raw.today, -7);
  const recentFrom = addDays(raw.today, -14);
  const nextStart = addDays(raw.weekStart, 7);
  return {
    generatedAt: opts.now.toISOString(),
    timezone: raw.tz,
    today: raw.today,
    todayWeekday: dayName(raw.today),
    weekStart: raw.weekStart,
    weekEnd,
    units: UNITS,
    athlete: athleteView(raw.profile),
    phase: phaseFor(raw.weekStart, raw.races),
    races: raw.races.filter((r) => r.date >= addDays(raw.today, -14)).map((r) => raceView(r, raw.today)),
    week: weekBlock(raw, raw.weekStart, weekEnd, opts.detail),
    ...(opts.includeNextWeek ? { nextWeek: { weekStart: nextStart, ...weekBlock(raw, nextStart, raw.windowEnd, opts.detail) } } : {}),
    jointSessions: raw.joint.filter((s) => s.status !== 'cancelled').map((s) => jointView(s, raw.profile.id)),
    lifeEvents: raw.events.filter((e) => e.endDate >= eventsFrom && e.startDate <= raw.windowEnd).map(lifeEventView),
    busy: busyView(raw.busy, raw.tz, raw.weekStart, raw.windowEnd),
    wellness: wellnessBlock(raw, opts.detail),
    loadHistory: weeklyLoadHistory(raw.workouts, raw.events, raw.weekStart, 6),
    ...(opts.detail === 'detailed'
      ? {
          recentSessions: raw.workouts
            .filter((w) => w.status !== 'planned' && w.date >= recentFrom && w.date <= raw.today && w.date < raw.weekStart)
            .map((w) => workoutView(w, 'concise', raw.joint, raw.profile.id)),
          nutrition: raw.nutrition.map((n) => ({ ...n })),
        }
      : {}),
    friends: raw.friends.map((f) => ({ friendId: f.friendId, name: f.displayName, username: f.username })),
    notes: NOTES,
  };
}
