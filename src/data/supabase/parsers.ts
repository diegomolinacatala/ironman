/**
 * Parsers for jsonb payloads (thresholds, availability, steps, completed data,
 * coaching, plan changes, joint sessions). Pure; tolerate partial / malformed
 * input by dropping invalid parts instead of throwing.
 */
import {
  INTENSITIES,
  RACE_DISTANCES,
  SPORTS,
  WORKOUT_SOURCES,
  type Availability,
  type CompletedData,
  type FriendRace,
  type Intensity,
  type JointComment,
  type JointParticipant,
  type JointSession,
  type NotificationPrefs,
  type NumberRange,
  type PlanChange,
  type Score5,
  type StepTarget,
  type Thresholds,
  type TrainingWindow,
  type Weekday,
  type WorkoutCoaching,
  type WorkoutDraft,
  type WorkoutStep,
  type WorkoutStepKind,
} from '@/domain/types';

import {
  asArray,
  asBoolean,
  asNumber,
  asString,
  isRecord,
  isWeekday,
  oneOf,
  oneOfOr,
  compact,
  pick,
  timeFromDb,
  type JsonRecord,
} from './narrow';

export const DEFAULT_AVAILABILITY: Availability = {
  weeklyHoursTarget: 8,
  restDay: 0,
  longSessionDays: [5, 6],
  windows: [],
  poolDays: [],
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  workoutReminders: true,
  reminderMinutesBefore: 30,
  morningSummary: true,
  morningTime: '07:30',
  eveningCheckin: true,
  eveningTime: '21:30',
  weeklyPlanReminder: true,
  social: true,
};

const THRESHOLD_KEYS = ['ftpW', 'runThresholdPaceSecPerKm', 'swimCssSecPer100m', 'maxHr', 'lthr', 'restingHr'] as const;
const STEP_KINDS: readonly WorkoutStepKind[] = ['warmup', 'work', 'recovery', 'cooldown', 'rest'];
const STEP_LEGS = ['bike', 'run'] as const;
const COMPLETED_SOURCES = ['manual', 'healthkit', 'garmin', 'claude'] as const;

/** Text limits of the v4 schema (`workouts.coaching`, step cues). */
export const COACHING_LIMITS = { objective: 200, key: 160, keys: 4, success: 200, planB: 200, cue: 200 } as const;

/** Accepted bounds of explicit step targets (same as domain/zones). Pace in s/km or s/100 m. */
const TARGET_BOUNDS: Readonly<Record<keyof StepTarget, readonly [number, number]>> = {
  hr: [40, 230],
  pace: [20, 1200],
  power: [0, 2000],
  rpe: [1, 10],
};
const TARGET_KEYS = Object.keys(TARGET_BOUNDS) as (keyof StepTarget)[];

/** Trimmed, non-empty text clipped to `max` characters; null otherwise. */
function boundedText(value: unknown, max: number): string | null {
  const s = asString(value)?.trim();
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

function score5(value: unknown): Score5 | null {
  const n = asNumber(value);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as Score5) : null;
}

function parseRange(value: unknown, [lo, hi]: readonly [number, number]): NumberRange | null {
  if (!isRecord(value)) return null;
  const min = asNumber(value.min);
  const max = asNumber(value.max);
  if (min === null || max === null) return null;
  if (min < lo || min > hi || max < lo || max > hi) return null;
  return min <= max ? { min, max } : { min: max, max: min };
}

/** `step.target` → only the valid ranges (hr / pace / power / rpe); null when none is usable. */
export function parseStepTarget(value: unknown): StepTarget | null {
  if (!isRecord(value)) return null;
  const target = TARGET_KEYS.reduce<StepTarget>((acc, key) => {
    const r = parseRange(value[key], TARGET_BOUNDS[key]);
    return r ? { ...acc, [key]: r } : acc;
  }, {});
  return Object.keys(target).length > 0 ? target : null;
}

/**
 * `workouts.coaching` / a draft's `coaching` → WorkoutCoaching, or null when it
 * has no objective or success criterion. Texts are trimmed and clipped to the
 * schema limits; at most 4 keys are kept.
 */
export function parseCoaching(value: unknown): WorkoutCoaching | null {
  if (!isRecord(value)) return null;
  const objective = boundedText(value.objective, COACHING_LIMITS.objective);
  const success = boundedText(value.success, COACHING_LIMITS.success);
  if (!objective || !success) return null;
  const keys = asArray(value.keys)
    .map((k) => boundedText(k, COACHING_LIMITS.key))
    .filter((k): k is string => k !== null)
    .slice(0, COACHING_LIMITS.keys);
  return { objective, keys, success, planB: boundedText(pick(value, 'planB', 'plan_b'), COACHING_LIMITS.planB) };
}

export function parseThresholds(value: unknown): Thresholds {
  if (!isRecord(value)) return {};
  return THRESHOLD_KEYS.reduce<Thresholds>((acc, key) => {
    const n = asNumber(value[key]);
    return n === null ? acc : { ...acc, [key]: n };
  }, {});
}

function weekdays(value: unknown): Weekday[] {
  return asArray(value).filter(isWeekday);
}

function parseWindow(value: unknown): TrainingWindow | null {
  if (!isRecord(value) || !isWeekday(value.weekday)) return null;
  const start = timeFromDb(value.start);
  const end = timeFromDb(value.end);
  if (!start || !end) return null;
  return { weekday: value.weekday, start, end };
}

export function parseAvailability(value: unknown): Availability {
  if (!isRecord(value)) return DEFAULT_AVAILABILITY;
  const restDay = value.restDay === null ? null : isWeekday(value.restDay) ? value.restDay : DEFAULT_AVAILABILITY.restDay;
  return {
    weeklyHoursTarget: asNumber(value.weeklyHoursTarget) ?? DEFAULT_AVAILABILITY.weeklyHoursTarget,
    restDay,
    longSessionDays: Array.isArray(value.longSessionDays)
      ? weekdays(value.longSessionDays)
      : DEFAULT_AVAILABILITY.longSessionDays,
    windows: asArray(value.windows)
      .map(parseWindow)
      .filter((w): w is TrainingWindow => w !== null),
    poolDays: weekdays(value.poolDays),
  };
}

export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  const record: JsonRecord = isRecord(value) ? value : {};
  const d = DEFAULT_NOTIFICATION_PREFS;
  return {
    workoutReminders: asBoolean(record.workoutReminders) ?? d.workoutReminders,
    reminderMinutesBefore: asNumber(record.reminderMinutesBefore) ?? d.reminderMinutesBefore,
    morningSummary: asBoolean(record.morningSummary) ?? d.morningSummary,
    morningTime: timeFromDb(record.morningTime) ?? d.morningTime,
    eveningCheckin: asBoolean(record.eveningCheckin) ?? d.eveningCheckin,
    eveningTime: timeFromDb(record.eveningTime) ?? d.eveningTime,
    weeklyPlanReminder: asBoolean(record.weeklyPlanReminder) ?? d.weeklyPlanReminder,
    social: asBoolean(record.social) ?? d.social,
  };
}

function parseStep(value: unknown): WorkoutStep | null {
  if (!isRecord(value)) return null;
  const kind = oneOf(value.kind, STEP_KINDS);
  if (!kind) return null;
  const durationMin = asNumber(value.durationMin);
  const distanceM = asNumber(value.distanceM);
  const intensity = oneOf(value.intensity, INTENSITIES);
  const repeat = asNumber(value.repeat);
  const note = asString(value.note);
  const target = parseStepTarget(value.target);
  const cue = boundedText(value.cue, COACHING_LIMITS.cue);
  const leg = oneOf(value.leg, STEP_LEGS);
  return {
    kind,
    ...(durationMin !== null ? { durationMin } : {}),
    ...(distanceM !== null ? { distanceM } : {}),
    ...(intensity ? { intensity } : {}),
    ...(repeat !== null ? { repeat } : {}),
    ...(note ? { note } : {}),
    ...(target ? { target } : {}),
    ...(cue ? { cue } : {}),
    ...(leg ? { leg } : {}),
  };
}

export function parseSteps(value: unknown): WorkoutStep[] {
  return asArray(value)
    .map(parseStep)
    .filter((s): s is WorkoutStep => s !== null);
}

export function parseCompleted(value: unknown): CompletedData | null {
  if (!isRecord(value)) return null;
  const numbers = (['durationMin', 'distanceM', 'avgHr', 'rpe', 'tss'] as const).reduce<CompletedData>((acc, key) => {
    const n = asNumber(value[key]);
    return n === null ? acc : { ...acc, [key]: n };
  }, {});
  const notes = asString(value.notes);
  const source = oneOf(value.source, COMPLETED_SOURCES);
  const externalId = asString(value.externalId);
  const completedAt = asString(value.completedAt);
  const feel = score5(value.feel);
  return {
    ...numbers,
    ...(feel !== null ? { feel } : {}),
    ...(notes !== null ? { notes } : {}),
    ...(source ? { source } : {}),
    ...(externalId ? { externalId } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Plan changes (camelCase jsonb, same shape as the domain `PlanChange`)
// ---------------------------------------------------------------------------

/** Absent or invalid → undefined (field omitted). */
function opt<T>(raw: unknown, parse: (v: unknown) => T | null): T | undefined {
  if (raw === undefined || raw === null) return undefined;
  return parse(raw) ?? undefined;
}

/** Like `opt` but an explicit null is kept (clears the field). */
function optNullable<T>(raw: unknown, parse: (v: unknown) => T | null): T | null | undefined {
  if (raw === null) return null;
  return opt(raw, parse);
}

function parseDraftFields(value: JsonRecord): Partial<WorkoutDraft> {
  return compact({
    date: opt(value.date, asString),
    startTime: optNullable(value.startTime, timeFromDb),
    sport: opt(value.sport, (v) => oneOf(v, SPORTS)),
    title: opt(value.title, asString),
    description: optNullable(value.description, asString),
    durationMin: opt(value.durationMin, asNumber),
    distanceM: optNullable(value.distanceM, asNumber),
    intensity: opt(value.intensity, (v) => oneOf<Intensity>(v, INTENSITIES)),
    tss: optNullable(value.tss, asNumber),
    steps: Array.isArray(value.steps) ? parseSteps(value.steps) : undefined,
    isKey: opt(value.isKey, asBoolean),
    // Objective, keys, success and plan B: null clears them, an unusable object is dropped.
    coaching: optNullable(value.coaching, parseCoaching),
    // Provenance ('rules' | 'ai_coach' | 'claude'…): apply_plan_changes stores it, defaulting to 'manual'.
    source: opt(value.source, (v) => oneOf(v, WORKOUT_SOURCES)),
  });
}

function parseFullDraft(value: unknown): WorkoutDraft | null {
  if (!isRecord(value)) return null;
  const fields = parseDraftFields(value);
  if (!fields.date || !fields.sport || fields.title === undefined || fields.durationMin === undefined || !fields.intensity) {
    return null;
  }
  return { ...fields, date: fields.date, sport: fields.sport, title: fields.title, durationMin: fields.durationMin, intensity: fields.intensity };
}

export function parsePlanChange(value: unknown): PlanChange | null {
  if (!isRecord(value)) return null;
  const reason = asString(value.reason) ?? '';
  const workoutId = asString(value.workoutId);
  switch (value.op) {
    case 'add': {
      const workout = parseFullDraft(value.workout);
      return workout ? { op: 'add', workout, reason } : null;
    }
    case 'update':
      return workoutId && isRecord(value.patch)
        ? { op: 'update', workoutId, patch: parseDraftFields(value.patch), reason }
        : null;
    case 'move': {
      const toDate = asString(value.toDate);
      if (!workoutId || !toDate) return null;
      const toStartTime = value.toStartTime === null ? null : timeFromDb(value.toStartTime) ?? undefined;
      return { op: 'move', workoutId, toDate, ...(toStartTime !== undefined ? { toStartTime } : {}), reason };
    }
    case 'delete':
      return workoutId ? { op: 'delete', workoutId, reason } : null;
    default:
      return null;
  }
}

export function parsePlanChanges(value: unknown): PlanChange[] {
  return asArray(value)
    .map(parsePlanChange)
    .filter((c): c is PlanChange => c !== null);
}

// ---------------------------------------------------------------------------
// Joint sessions (`list_joint_sessions` returns camelCase jsonb objects)
// ---------------------------------------------------------------------------

const JOINT_STATUSES = ['proposed', 'confirmed', 'cancelled'] as const;
const PARTICIPANT_STATUSES = ['invited', 'accepted', 'declined'] as const;

function parseParticipant(value: unknown): JointParticipant | null {
  if (!isRecord(value)) return null;
  const userId = asString(pick(value, 'userId', 'user_id'));
  if (!userId) return null;
  return {
    userId,
    displayName: asString(pick(value, 'displayName', 'display_name')) ?? '',
    avatarUrl: asString(pick(value, 'avatarUrl', 'avatar_url')),
    status: oneOfOr(value.status, PARTICIPANT_STATUSES, 'invited'),
    workoutId: asString(pick(value, 'workoutId', 'workout_id')),
  };
}

export function parseJointSession(value: unknown): JointSession | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const organizerId = asString(pick(value, 'organizerId', 'organizer_id'));
  const date = asString(value.date);
  if (!id || !organizerId || !date) return null;
  return {
    id,
    organizerId,
    sport: oneOfOr(value.sport, SPORTS, 'other'),
    date,
    startTime: timeFromDb(pick(value, 'startTime', 'start_time')),
    durationMin: asNumber(pick(value, 'durationMin', 'duration_min')) ?? 0,
    intensity: oneOfOr(value.intensity, INTENSITIES, 'endurance'),
    title: asString(value.title) ?? '',
    location: asString(value.location),
    notes: asString(value.notes),
    status: oneOfOr(value.status, JOINT_STATUSES, 'proposed'),
    isOpen: asBoolean(pick(value, 'isOpen', 'is_open')) ?? false,
    participants: asArray(value.participants)
      .map(parseParticipant)
      .filter((p): p is JointParticipant => p !== null),
    createdAt: asString(pick(value, 'createdAt', 'created_at')) ?? '',
  };
}

export function parseJointSessions(value: unknown): JointSession[] {
  return asArray(value)
    .map(parseJointSession)
    .filter((s): s is JointSession => s !== null);
}

export function parseJointComment(value: unknown): JointComment | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const sessionId = asString(pick(value, 'sessionId', 'session_id'));
  const userId = asString(pick(value, 'userId', 'user_id'));
  const body = asString(value.body);
  if (!id || !sessionId || !userId || !body) return null;
  return {
    id,
    sessionId,
    userId,
    displayName: asString(pick(value, 'displayName', 'display_name')) ?? '',
    body,
    createdAt: asString(pick(value, 'createdAt', 'created_at')) ?? '',
  };
}

export function parseJointComments(value: unknown): JointComment[] {
  return asArray(value)
    .map(parseJointComment)
    .filter((c): c is JointComment => c !== null);
}

const RACE_PRIORITIES = ['A', 'B', 'C'] as const;

export function parseFriendRace(value: unknown): FriendRace | null {
  if (!isRecord(value)) return null;
  const friendId = asString(pick(value, 'friendId', 'friend_id'));
  const raceId = asString(pick(value, 'raceId', 'race_id'));
  const date = asString(value.date);
  if (!friendId || !raceId || !date) return null;
  return {
    friendId,
    raceId,
    displayName: asString(pick(value, 'displayName', 'display_name')) ?? '',
    name: asString(value.name),
    date,
    distance: oneOfOr(value.distance, RACE_DISTANCES, 'other'),
    priority: oneOfOr(value.priority, RACE_PRIORITIES, 'A'),
  };
}

export function parseFriendRaces(value: unknown): FriendRace[] {
  return asArray(value)
    .map(parseFriendRace)
    .filter((r): r is FriendRace => r !== null);
}
