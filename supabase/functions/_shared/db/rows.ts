/**
 * Pure mappers between Postgres rows (snake_case, `unknown` from PostgREST)
 * and the edge-function domain types. Defensive: bad values fall back to safe
 * defaults instead of throwing, so one odd row never breaks a whole response.
 */
import { normalizeTime } from '../dates.ts';
import {
  BODY_AREAS,
  INTENSITIES,
  LIFE_EVENT_KINDS,
  RACE_DISTANCES,
  RACE_PRIORITIES,
  SPORTS,
  WORKOUT_SOURCES,
  WORKOUT_STATUSES,
} from '../types.ts';
import type {
  Availability,
  BusyBlock,
  CompletedData,
  DailyCheckin,
  DailyMetrics,
  FriendSummary,
  FriendWeekItem,
  JointParticipant,
  JointSession,
  LifeEvent,
  NutritionLog,
  Profile,
  Race,
  Thresholds,
  Workout,
  WorkoutStep,
} from '../types.ts';

type Row = Record<string, unknown>;

export const asRow = (v: unknown): Row => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};
const dateStr = (v: unknown): string => str(v).slice(0, 10);

function oneOf<T extends string>(values: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}

function steps(v: unknown): WorkoutStep[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'object' && s !== null).map((s) => ({ ...(s as WorkoutStep) })) : [];
}

export function mapWorkout(raw: unknown): Workout {
  const r = asRow(raw);
  return {
    id: str(r.id),
    userId: str(r.user_id),
    date: dateStr(r.date),
    startTime: normalizeTime(r.start_time),
    sport: oneOf(SPORTS, r.sport, 'other'),
    title: str(r.title, 'Entreno'),
    description: strOrNull(r.description),
    durationMin: num(r.duration_min),
    distanceM: numOrNull(r.distance_m),
    intensity: oneOf(INTENSITIES, r.intensity, 'endurance'),
    tss: numOrNull(r.tss),
    steps: steps(r.steps),
    status: oneOf(WORKOUT_STATUSES, r.status, 'planned'),
    completed: r.completed && typeof r.completed === 'object' ? ({ ...(r.completed as CompletedData) }) : null,
    source: oneOf(WORKOUT_SOURCES, r.source, 'manual'),
    isKey: r.is_key === true,
    jointSessionId: strOrNull(r.joint_session_id),
    externalId: strOrNull(r.external_id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapRace(raw: unknown): Race {
  const r = asRow(raw);
  return {
    id: str(r.id),
    name: str(r.name),
    date: dateStr(r.date),
    distance: oneOf(RACE_DISTANCES, r.distance, 'other'),
    priority: oneOf(RACE_PRIORITIES, r.priority, 'B'),
    location: strOrNull(r.location),
    goal: strOrNull(r.goal),
    notes: strOrNull(r.notes),
  };
}

export function mapLifeEvent(raw: unknown): LifeEvent {
  const r = asRow(raw);
  const severity = num(r.severity, 2);
  return {
    id: str(r.id),
    kind: oneOf(LIFE_EVENT_KINDS, r.kind, 'other'),
    title: str(r.title),
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date ?? r.start_date),
    startTime: normalizeTime(r.start_time),
    durationMin: numOrNull(r.duration_min),
    severity: severity === 1 || severity === 3 ? severity : 2,
    bodyArea: r.body_area == null ? null : oneOf(BODY_AREAS, r.body_area, 'other'),
    notes: strOrNull(r.notes),
  };
}

export function mapBusyBlock(raw: unknown): BusyBlock {
  const r = asRow(raw);
  return { id: str(r.id), start: str(r.starts_at), end: str(r.ends_at), title: strOrNull(r.title) };
}

export function mapCheckin(raw: unknown): DailyCheckin {
  const r = asRow(raw);
  return {
    date: dateStr(r.date),
    sleepQuality: num(r.sleep_quality, 3),
    sleepHours: numOrNull(r.sleep_hours),
    fatigue: num(r.fatigue, 3),
    soreness: num(r.soreness, 1),
    stress: num(r.stress, 3),
    motivation: num(r.motivation, 3),
    notes: strOrNull(r.notes),
  };
}

export function mapMetrics(raw: unknown): DailyMetrics {
  const r = asRow(raw);
  return {
    date: dateStr(r.date),
    source: oneOf(['healthkit', 'garmin', 'manual'] as const, r.source, 'manual'),
    hrvMs: numOrNull(r.hrv_ms),
    restingHr: numOrNull(r.resting_hr),
    sleepHours: numOrNull(r.sleep_hours),
    sleepScore: numOrNull(r.sleep_score),
    bodyBattery: numOrNull(r.body_battery),
    trainingReadiness: numOrNull(r.training_readiness),
    vo2max: numOrNull(r.vo2max),
    steps: numOrNull(r.steps),
    stressAvg: numOrNull(r.stress_avg),
    trainingStatus: strOrNull(r.training_status),
  };
}

export function mapNutrition(raw: unknown): NutritionLog {
  const r = asRow(raw);
  return {
    date: dateStr(r.date),
    meal: str(r.meal),
    description: str(r.description),
    kcal: numOrNull(r.kcal),
    carbsG: numOrNull(r.carbs_g),
    proteinG: numOrNull(r.protein_g),
    fatG: numOrNull(r.fat_g),
  };
}

const DEFAULT_AVAILABILITY: Availability = { weeklyHoursTarget: 8, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] };

function availability(v: unknown): Availability {
  const a = asRow(v);
  const days = (x: unknown): number[] => (Array.isArray(x) ? x.map((d) => num(d, -1)).filter((d) => d >= 0 && d <= 6) : []);
  const windows = Array.isArray(a.windows)
    ? a.windows.map(asRow).flatMap((w) => {
        const start = normalizeTime(w.start);
        const end = normalizeTime(w.end);
        const weekday = num(w.weekday, -1);
        return start && end && weekday >= 0 && weekday <= 6 ? [{ weekday, start, end }] : [];
      })
    : [];
  return {
    weeklyHoursTarget: num(a.weeklyHoursTarget, DEFAULT_AVAILABILITY.weeklyHoursTarget),
    restDay: a.restDay === null ? null : numOrNull(a.restDay) ?? DEFAULT_AVAILABILITY.restDay,
    longSessionDays: Array.isArray(a.longSessionDays) ? days(a.longSessionDays) : DEFAULT_AVAILABILITY.longSessionDays,
    windows,
    poolDays: days(a.poolDays),
  };
}

export function mapProfile(raw: unknown): Profile {
  const r = asRow(raw);
  return {
    id: str(r.id),
    username: str(r.username),
    displayName: str(r.display_name, 'Atleta'),
    sports: Array.isArray(r.sports) ? r.sports.map((s) => str(s)) : [],
    level: str(r.level, 'intermediate'),
    thresholds: { ...(asRow(r.thresholds) as Thresholds) },
    availability: availability(r.availability),
    visibility: oneOf(['full', 'summary', 'busy'] as const, r.visibility, 'full'),
    notificationPrefs: { ...asRow(r.notification_prefs) },
    timezone: str(r.timezone, 'Europe/Madrid') || 'Europe/Madrid',
    coachNotes: strOrNull(r.coach_notes),
  };
}

export function mapFriendWeekItem(raw: unknown): FriendWeekItem {
  const r = asRow(raw);
  return {
    kind: oneOf(['workout', 'busy', 'event'] as const, r.kind, 'busy'),
    id: strOrNull(r.id),
    date: dateStr(r.date),
    startTime: normalizeTime(r.start_time),
    endTime: normalizeTime(r.end_time),
    durationMin: numOrNull(r.duration_min),
    sport: r.sport == null ? null : oneOf(SPORTS, r.sport, 'other'),
    intensity: r.intensity == null ? null : oneOf(INTENSITIES, r.intensity, 'endurance'),
    title: strOrNull(r.title),
    status: r.status == null ? null : oneOf(WORKOUT_STATUSES, r.status, 'planned'),
    jointSessionId: strOrNull(r.joint_session_id),
  };
}

/** Rows of svc_list_friends → accepted friends only. */
export function mapAcceptedFriends(rows: readonly unknown[]): FriendSummary[] {
  return rows
    .map(asRow)
    .filter((r) => r.status === 'accepted' && typeof r.friend_id === 'string')
    .map((r) => ({ friendId: str(r.friend_id), username: str(r.username), displayName: str(r.display_name, str(r.username)) }));
}

export function assembleJointSessions(sessions: readonly unknown[], participants: readonly unknown[], profiles: readonly unknown[]): JointSession[] {
  const names = new Map(profiles.map(asRow).map((p) => [str(p.id), str(p.display_name, 'Amigo')]));
  const bySession = new Map<string, JointParticipant[]>();
  for (const p of participants.map(asRow)) {
    const list = bySession.get(str(p.session_id)) ?? [];
    bySession.set(str(p.session_id), [
      ...list,
      {
        userId: str(p.user_id),
        displayName: names.get(str(p.user_id)) ?? 'Amigo',
        status: oneOf(['invited', 'accepted', 'declined'] as const, p.status, 'invited'),
        workoutId: strOrNull(p.workout_id),
      },
    ]);
  }
  return sessions.map(asRow).map((s) => ({
    id: str(s.id),
    organizerId: str(s.organizer_id),
    sport: oneOf(SPORTS, s.sport, 'other'),
    date: dateStr(s.date),
    startTime: normalizeTime(s.start_time),
    durationMin: num(s.duration_min, 60),
    intensity: oneOf(INTENSITIES, s.intensity, 'endurance'),
    title: str(s.title, 'Quedada'),
    location: strOrNull(s.location),
    status: oneOf(['proposed', 'confirmed', 'cancelled'] as const, s.status, 'proposed'),
    participants: bySession.get(str(s.id)) ?? [],
  }));
}
