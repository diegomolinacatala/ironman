/**
 * The single "planning context" used by both the MCP tool
 * `get_planning_context` and the in-app AI coach: everything needed to plan or
 * re-plan a week, compact, camelCase, ids included, Spanish labels. v4: the
 * athlete's zones with numbers, their watch, the season ahead ("Plan →
 * General"), the week as the app shows it (week plan applied) and, per
 * workout, the main-set targets, the coach's prescription and plan vs done.
 */
import { addDays, DEFAULT_TZ, localParts, startOfWeek, todayIn, weekdayOf, WEEKDAYS_ES, zonedToUtc } from '../dates.ts';
import type { BusyBlock, ISODate, JointSession, LifeEvent, Profile, Race, UUID, WeekPlan, Workout } from '../types.ts';
import { athleteView } from './athlete-view.ts';
import { lifeEventLabel, raceDistanceLabel } from './labels.ts';
import { weeklyLoadHistory, weekTotals } from './load.ts';
import type { WeeklyLoad, WeekTotals } from './load.ts';
import { phaseFor } from './phase.ts';
import type { PhaseInfo } from './phase.ts';
import { seasonOf, seasonView } from './season-view.ts';
import type { SeasonView } from './season-view.ts';
import type { PlanningReader } from './store.ts';
import { mergeMetricsByDate, wellnessSignals } from './wellness.ts';
import type { WellnessSignals } from './wellness.ts';
import { workoutView } from './workout-view.ts';
import type { Detail, ViewContext, WorkoutView } from './workout-view.ts';

export type { Detail, WorkoutView };

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
  /** The weeks ahead at a glance (Plan → General). */
  season: SeasonView;
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
  'Fechas YYYY-MM-DD y horas HH:mm en hora local (zona del atleta, normalmente Europe/Madrid). Duraciones en minutos, distancias en metros, carga en puntos (100 ≈ 1 h a umbral). FC en ppm, ritmos en min:s por km (carrera) o por 100 m (natación), potencia en vatios, RPE 1-10. Días: lunes…domingo.';

/** Season rows in the context: enough for "las próximas semanas" without bloating 'concise'. */
const SEASON_ROWS: Readonly<Record<Detail, number>> = { concise: 8, detailed: 16 };
const WEEK_PLAN_LOOKAHEAD_DAYS = 7 * 52;

const dayName = (date: ISODate): string => WEEKDAYS_ES[weekdayOf(date)];

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
  const { createdAt: _createdAt, ...race } = r;
  const days = Math.round((Date.parse(r.date) - Date.parse(today)) / 86_400_000);
  return { ...race, distanceLabel: raceDistanceLabel(r.distance), daysToRace: days };
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
  weekPlans: WeekPlan[];
}

async function loadRaw(reader: PlanningReader, opts: ContextOptions): Promise<RawContext> {
  const profile = await reader.getProfile(opts.userId);
  if (!profile) throw new NotFoundError('No hay perfil para este usuario. Completa el registro en la app.');
  const tz = profile.timezone || DEFAULT_TZ;
  const today = todayIn(tz, opts.now);
  const weekStart = startOfWeek(opts.weekStart ?? today);
  const windowEnd = addDays(weekStart, opts.includeNextWeek ? 13 : 6);
  const historyFrom = addDays(weekStart < today ? weekStart : today, -42);
  const thisMonday = startOfWeek(today);
  const plansFrom = weekStart < thisMonday ? weekStart : thisMonday;
  const [workouts, races, events, busy, checkins, metrics, nutrition, joint, friends, weekPlans] = await Promise.all([
    reader.listWorkouts(opts.userId, historyFrom, windowEnd),
    reader.listRaces(opts.userId),
    reader.listLifeEvents(opts.userId, historyFrom, windowEnd),
    reader.listBusyBlocks(opts.userId, zonedToUtc(weekStart, '00:00', tz), zonedToUtc(addDays(windowEnd, 1), '00:00', tz)),
    reader.listCheckins(opts.userId, addDays(today, -13), today),
    reader.listMetrics(opts.userId, addDays(today, -13), today),
    opts.detail === 'detailed' ? reader.listNutrition(opts.userId, addDays(today, -2), today) : Promise.resolve([]),
    reader.listJointSessions(opts.userId, weekStart, windowEnd),
    reader.listFriends(opts.userId),
    reader.listWeekPlans(opts.userId, plansFrom, addDays(thisMonday, WEEK_PLAN_LOOKAHEAD_DAYS)),
  ]);
  return { profile, tz, today, weekStart, windowEnd, workouts, races, events, busy, checkins, metrics, nutrition, joint, friends, weekPlans };
}

function weekBlock(raw: RawContext, view: ViewContext, from: ISODate, to: ISODate): { totals: WeekTotals; workouts: WorkoutView[] } {
  const list = raw.workouts
    .filter((w) => inRange(w.date, from, to))
    .sort((a, b) => (a.date + (a.startTime ?? '99')).localeCompare(b.date + (b.startTime ?? '99')));
  return { totals: weekTotals(list), workouts: list.map((w) => workoutView(w, view)) };
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
  'Cada sesión nueva o cambiada lleva su prescripción: steps con objetivos de athlete.zones (o target explícito), cue de sensaciones y coaching (objective, keys, success, planB). Nunca inventes cifras: si faltan umbrales (athlete.zones.missing), usa RPE y sensaciones.',
  'season es el plan general (Plan → General): fixed=true no admite ajuste; adjusted=true ya tiene uno. Para planificar semanas por encima usa set_week_plans, no entrenos sueltos.',
  'Las quedadas (jointSessionId / partners) son compromisos con otra persona: muévelas solo si es imprescindible y explica por qué.',
  'Las sesiones isKey=true son las clave de la semana: protégelas y ajusta antes las accesorias.',
  'Las métricas del reloj (Garmin o COROS) guardadas aquí pueden ir con retraso respecto a sus conectores.',
  'Ante dolor, lesión o enfermedad: prioriza la seguridad y recomienda consultar a un profesional sanitario.',
];

function viewContext(raw: RawContext, detail: Detail, raceDistance: ViewContext['raceDistance']): ViewContext {
  return { detail, sessions: raw.joint, userId: raw.profile.id, thresholds: raw.profile.thresholds, raceDistance, today: raw.today };
}

function recentBlock(raw: RawContext, view: ViewContext): WorkoutView[] {
  const recentFrom = addDays(raw.today, -14);
  return raw.workouts
    .filter((w) => w.status !== 'planned' && w.date >= recentFrom && w.date <= raw.today && w.date < raw.weekStart)
    .map((w) => workoutView(w, { ...view, detail: 'concise' }));
}

/** Builds the planning context. Throws NotFoundError when the user has no profile. */
export async function buildPlanningContext(reader: PlanningReader, opts: ContextOptions): Promise<PlanningContext> {
  const raw = await loadRaw(reader, opts);
  const weekEnd = addDays(raw.weekStart, 6);
  const eventsFrom = addDays(raw.weekStart < raw.today ? raw.weekStart : raw.today, -7);
  const nextStart = addDays(raw.weekStart, 7);
  const hours = raw.profile.availability.weeklyHoursTarget;
  const season = seasonOf({ today: raw.today, races: raw.races, level: raw.profile.level, weeklyHoursTarget: hours, weekPlans: raw.weekPlans });
  const raceDistance = season.targetRace?.distance ?? null;
  const view = viewContext(raw, opts.detail, raceDistance);
  return {
    generatedAt: opts.now.toISOString(),
    timezone: raw.tz,
    today: raw.today,
    todayWeekday: dayName(raw.today),
    weekStart: raw.weekStart,
    weekEnd,
    units: UNITS,
    athlete: athleteView(raw.profile, raceDistance),
    phase: phaseFor(raw.weekStart, raw.races, { level: raw.profile.level, weeklyHoursTarget: hours, weekPlans: raw.weekPlans, today: raw.today, season }),
    season: seasonView(season, SEASON_ROWS[opts.detail]),
    races: raw.races.filter((r) => r.date >= addDays(raw.today, -14)).map((r) => raceView(r, raw.today)),
    week: weekBlock(raw, view, raw.weekStart, weekEnd),
    ...(opts.includeNextWeek ? { nextWeek: { weekStart: nextStart, ...weekBlock(raw, view, nextStart, raw.windowEnd) } } : {}),
    jointSessions: raw.joint.filter((s) => s.status !== 'cancelled').map((s) => jointView(s, raw.profile.id)),
    lifeEvents: raw.events.filter((e) => e.endDate >= eventsFrom && e.startDate <= raw.windowEnd).map(lifeEventView),
    busy: busyView(raw.busy, raw.tz, raw.weekStart, raw.windowEnd),
    wellness: wellnessBlock(raw, opts.detail),
    loadHistory: weeklyLoadHistory(raw.workouts, raw.events, raw.weekStart, 6),
    ...(opts.detail === 'detailed' ? { recentSessions: recentBlock(raw, view), nutrition: raw.nutrition.map((n) => ({ ...n })) } : {}),
    friends: raw.friends.map((f) => ({ friendId: f.friendId, name: f.displayName, username: f.username })),
    notes: NOTES,
  };
}
