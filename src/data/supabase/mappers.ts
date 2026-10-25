/**
 * snake_case rows ↔ domain types. Pure functions (no I/O), unit-tested in
 * `src/data/__tests__/mappers.test.ts`.
 *
 * `rowToX` narrows untrusted values (enums fall back to safe defaults);
 * `xToRow` / `draftToInsert` / `patchToUpdate` produce the column objects
 * sent to PostgREST.
 */
import {
  INTENSITIES,
  LIFE_EVENT_KINDS,
  BODY_AREAS,
  MEAL_SLOTS,
  NOTIFICATION_TYPES,
  RACE_DISTANCES,
  SPORTS,
  TRAINABLE_SPORTS,
  WORKOUT_SOURCES,
  type AppNotification,
  type BusyBlock,
  type BusyBlockDraft,
  type CheckinDraft,
  type DailyCheckin,
  type DailyMetrics,
  type LifeEvent,
  type LifeEventDraft,
  type MetricsDraft,
  type NutritionDraft,
  type NutritionLog,
  type PlanProposal,
  type Profile,
  type ProfilePatch,
  type ProposalDraft,
  type PublicProfile,
  type Race,
  type RaceDraft,
  type Score5,
  type Severity,
  type TrainableSport,
  type Workout,
  type WorkoutDraft,
  type WorkoutPatch,
} from '@/domain/types';

import { asNumber, compact, isRecord, oneOf, oneOfOr, timeFromDb } from './narrow';
import { parseAvailability, parseCompleted, parseNotificationPrefs, parsePlanChanges, parseSteps, parseThresholds } from './parsers';
import type {
  BusyBlockRow,
  CheckinRow,
  LifeEventRow,
  MetricsRow,
  NotificationRow,
  NutritionRow,
  ProfileRow,
  ProposalRow,
  RaceRow,
  WorkoutRow,
} from './rows';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const VISIBILITIES = ['full', 'summary', 'busy'] as const;
const WORKOUT_STATUSES = ['planned', 'completed', 'skipped'] as const;
const PRIORITIES = ['A', 'B', 'C'] as const;
const BUSY_SOURCES = ['device_calendar', 'manual'] as const;
const METRICS_SOURCES = ['healthkit', 'garmin', 'manual'] as const;
const PROPOSAL_KINDS = ['generate_week', 'replan', 'chat'] as const;
const PROPOSAL_SOURCES = ['rules', 'ai_coach', 'claude'] as const;
const PROPOSAL_STATUSES = ['pending', 'applied', 'partially_applied', 'discarded'] as const;

type Row = Record<string, unknown>;

function clampScore(value: unknown): Score5 {
  const n = Math.round(asNumber(value) ?? 3);
  return Math.min(5, Math.max(1, n)) as Score5;
}

function severityOf(value: unknown): Severity {
  const n = Math.round(asNumber(value) ?? 2);
  return Math.min(3, Math.max(1, n)) as Severity;
}

export function sportsOf(value: unknown): TrainableSport[] {
  return Array.isArray(value) ? value.filter((s): s is TrainableSport => oneOf(s, TRAINABLE_SPORTS) !== null) : [];
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    sports: sportsOf(row.sports),
    level: oneOfOr(row.level, LEVELS, 'intermediate'),
    thresholds: parseThresholds(row.thresholds),
    availability: parseAvailability(row.availability),
    visibility: oneOfOr(row.visibility, VISIBILITIES, 'full'),
    notificationPrefs: parseNotificationPrefs(row.notification_prefs),
    timezone: row.timezone,
    coachNotes: row.coach_notes,
    onboardedAt: row.onboarded_at,
    aiConsentAt: row.ai_consent_at ?? null,
    createdAt: row.created_at,
  };
}

export function profileToRow(profile: Profile): ProfileRow {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    sports: profile.sports,
    level: profile.level,
    thresholds: profile.thresholds,
    availability: profile.availability,
    visibility: profile.visibility,
    notification_prefs: profile.notificationPrefs,
    timezone: profile.timezone,
    coach_notes: profile.coachNotes,
    onboarded_at: profile.onboardedAt,
    ai_consent_at: profile.aiConsentAt,
    created_at: profile.createdAt,
  };
}

/** Only the provided keys are emitted (PATCH semantics). */
export function profilePatchToRow(patch: ProfilePatch): Row {
  return compact({
    username: patch.username?.trim().toLowerCase(),
    display_name: patch.displayName?.trim(),
    avatar_url: patch.avatarUrl,
    sports: patch.sports,
    level: patch.level,
    thresholds: patch.thresholds,
    availability: patch.availability,
    visibility: patch.visibility,
    notification_prefs: patch.notificationPrefs,
    timezone: patch.timezone,
    coach_notes: patch.coachNotes,
    onboarded_at: patch.onboardedAt,
    ai_consent_at: patch.aiConsentAt,
  });
}

export function rowToPublicProfile(row: {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  sports: unknown;
}): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    sports: sportsOf(row.sports),
  };
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export function rowToWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    startTime: timeFromDb(row.start_time),
    sport: oneOfOr(row.sport, SPORTS, 'other'),
    title: row.title,
    description: row.description,
    durationMin: asNumber(row.duration_min) ?? 0,
    distanceM: asNumber(row.distance_m),
    intensity: oneOfOr(row.intensity, INTENSITIES, 'endurance'),
    tss: asNumber(row.tss),
    steps: parseSteps(row.steps),
    status: oneOfOr(row.status, WORKOUT_STATUSES, 'planned'),
    completed: parseCompleted(row.completed),
    source: oneOfOr(row.source, WORKOUT_SOURCES, 'manual'),
    isKey: row.is_key === true,
    jointSessionId: row.joint_session_id,
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function workoutToRow(w: Workout): WorkoutRow {
  return {
    id: w.id,
    user_id: w.userId,
    date: w.date,
    start_time: w.startTime,
    sport: w.sport,
    title: w.title,
    description: w.description,
    duration_min: w.durationMin,
    distance_m: w.distanceM,
    intensity: w.intensity,
    tss: w.tss,
    steps: w.steps,
    status: w.status,
    completed: w.completed,
    source: w.source,
    is_key: w.isKey,
    joint_session_id: w.jointSessionId,
    external_id: w.externalId,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

/** Columns for INSERT. Durations/distances are rounded to the integer columns. */
export function workoutDraftToInsert(draft: WorkoutDraft, userId: string): Row {
  return {
    user_id: userId,
    date: draft.date,
    start_time: draft.startTime ?? null,
    sport: draft.sport,
    title: draft.title.trim(),
    description: draft.description ?? null,
    duration_min: Math.round(draft.durationMin),
    distance_m: draft.distanceM == null ? null : Math.round(draft.distanceM),
    intensity: draft.intensity,
    tss: draft.tss ?? null,
    steps: draft.steps ?? [],
    is_key: draft.isKey ?? false,
    source: draft.source ?? 'manual',
    external_id: draft.externalId ?? null,
  };
}

export function workoutPatchToUpdate(patch: WorkoutPatch): Row {
  return compact({
    date: patch.date,
    start_time: patch.startTime,
    sport: patch.sport,
    title: patch.title?.trim(),
    description: patch.description,
    duration_min: patch.durationMin === undefined ? undefined : Math.round(patch.durationMin),
    distance_m: patch.distanceM === undefined || patch.distanceM === null ? patch.distanceM : Math.round(patch.distanceM),
    intensity: patch.intensity,
    tss: patch.tss,
    steps: patch.steps,
    is_key: patch.isKey,
    source: patch.source,
    status: patch.status,
    completed: patch.completed,
  });
}

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

export function rowToRace(row: RaceRow): Race {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    date: row.date,
    distance: oneOfOr(row.distance, RACE_DISTANCES, 'other'),
    priority: oneOfOr(row.priority, PRIORITIES, 'A'),
    location: row.location,
    goal: row.goal,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function raceToRow(race: Race): RaceRow {
  return {
    id: race.id,
    user_id: race.userId,
    name: race.name,
    date: race.date,
    distance: race.distance,
    priority: race.priority,
    location: race.location,
    goal: race.goal,
    notes: race.notes,
    created_at: race.createdAt,
  };
}

export function racePatchToRow(patch: Partial<RaceDraft>): Row {
  return compact({
    name: patch.name?.trim(),
    date: patch.date,
    distance: patch.distance,
    priority: patch.priority,
    location: patch.location,
    goal: patch.goal,
    notes: patch.notes,
  });
}

export function raceDraftToInsert(draft: RaceDraft, userId: string): Row {
  return {
    user_id: userId,
    location: null,
    goal: null,
    notes: null,
    ...racePatchToRow(draft),
  };
}

// ---------------------------------------------------------------------------
// Life events
// ---------------------------------------------------------------------------

export function rowToLifeEvent(row: LifeEventRow): LifeEvent {
  return {
    id: row.id,
    userId: row.user_id,
    kind: oneOfOr(row.kind, LIFE_EVENT_KINDS, 'other'),
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: timeFromDb(row.start_time),
    durationMin: asNumber(row.duration_min),
    severity: severityOf(row.severity),
    bodyArea: oneOf(row.body_area, BODY_AREAS),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function lifeEventToRow(e: LifeEvent): LifeEventRow {
  return {
    id: e.id,
    user_id: e.userId,
    kind: e.kind,
    title: e.title,
    start_date: e.startDate,
    end_date: e.endDate,
    start_time: e.startTime,
    duration_min: e.durationMin,
    severity: e.severity,
    body_area: e.bodyArea,
    notes: e.notes,
    created_at: e.createdAt,
  };
}

export function lifeEventPatchToRow(patch: Partial<LifeEventDraft>): Row {
  return compact({
    kind: patch.kind,
    title: patch.title?.trim(),
    start_date: patch.startDate,
    end_date: patch.endDate,
    start_time: patch.startTime,
    duration_min: patch.durationMin,
    severity: patch.severity,
    body_area: patch.bodyArea,
    notes: patch.notes,
  });
}

export function lifeEventDraftToInsert(draft: LifeEventDraft, userId: string): Row {
  return {
    user_id: userId,
    start_time: null,
    duration_min: null,
    body_area: null,
    notes: null,
    ...lifeEventPatchToRow(draft),
    end_date: draft.endDate ?? draft.startDate,
  };
}

// ---------------------------------------------------------------------------
// Busy blocks
// ---------------------------------------------------------------------------

export function rowToBusyBlock(row: BusyBlockRow): BusyBlock {
  return {
    id: row.id,
    userId: row.user_id,
    start: row.starts_at,
    end: row.ends_at,
    source: oneOfOr(row.source, BUSY_SOURCES, 'manual'),
    title: row.title,
    externalId: row.external_id,
  };
}

export function busyBlockToRow(b: BusyBlock): BusyBlockRow {
  return {
    id: b.id,
    user_id: b.userId,
    starts_at: b.start,
    ends_at: b.end,
    source: b.source,
    title: b.title,
    external_id: b.externalId,
  };
}

export function busyBlockDraftToInsert(draft: BusyBlockDraft, userId: string): Row {
  return {
    user_id: userId,
    starts_at: draft.start,
    ends_at: draft.end,
    source: draft.source,
    title: draft.title ?? null,
    external_id: draft.externalId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Wellness
// ---------------------------------------------------------------------------

export function rowToCheckin(row: CheckinRow): DailyCheckin {
  return {
    userId: row.user_id,
    date: row.date,
    sleepQuality: clampScore(row.sleep_quality),
    sleepHours: asNumber(row.sleep_hours),
    fatigue: clampScore(row.fatigue),
    soreness: clampScore(row.soreness),
    stress: clampScore(row.stress),
    motivation: clampScore(row.motivation),
    notes: row.notes,
  };
}

export function checkinDraftToRow(draft: CheckinDraft, userId: string): CheckinRow {
  return {
    user_id: userId,
    date: draft.date,
    sleep_quality: draft.sleepQuality,
    sleep_hours: draft.sleepHours,
    fatigue: draft.fatigue,
    soreness: draft.soreness,
    stress: draft.stress,
    motivation: draft.motivation,
    notes: draft.notes,
  };
}

export function rowToMetrics(row: MetricsRow): DailyMetrics {
  return {
    userId: row.user_id,
    date: row.date,
    source: oneOfOr(row.source, METRICS_SOURCES, 'manual'),
    hrvMs: asNumber(row.hrv_ms),
    restingHr: asNumber(row.resting_hr),
    sleepHours: asNumber(row.sleep_hours),
    sleepScore: asNumber(row.sleep_score),
    bodyBattery: asNumber(row.body_battery),
    trainingReadiness: asNumber(row.training_readiness),
    vo2max: asNumber(row.vo2max),
    steps: asNumber(row.steps),
    stressAvg: asNumber(row.stress_avg),
    trainingStatus: row.training_status,
  };
}

export function metricsDraftToRow(draft: MetricsDraft, userId: string): MetricsRow {
  return {
    user_id: userId,
    date: draft.date,
    source: draft.source,
    hrv_ms: draft.hrvMs,
    resting_hr: draft.restingHr,
    sleep_hours: draft.sleepHours,
    sleep_score: draft.sleepScore,
    body_battery: draft.bodyBattery,
    training_readiness: draft.trainingReadiness,
    vo2max: draft.vo2max,
    steps: draft.steps == null ? null : Math.round(draft.steps),
    stress_avg: draft.stressAvg,
    training_status: draft.trainingStatus,
  };
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export function rowToNutrition(row: NutritionRow): NutritionLog {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    meal: oneOfOr(row.meal, MEAL_SLOTS, 'snack'),
    description: row.description,
    kcal: asNumber(row.kcal),
    carbsG: asNumber(row.carbs_g),
    proteinG: asNumber(row.protein_g),
    fatG: asNumber(row.fat_g),
    createdAt: row.created_at,
  };
}

export function nutritionToRow(n: NutritionLog): NutritionRow {
  return {
    id: n.id,
    user_id: n.userId,
    date: n.date,
    meal: n.meal,
    description: n.description,
    kcal: n.kcal,
    carbs_g: n.carbsG,
    protein_g: n.proteinG,
    fat_g: n.fatG,
    created_at: n.createdAt,
  };
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}

export function nutritionDraftToInsert(draft: NutritionDraft, userId: string): Row {
  return {
    user_id: userId,
    date: draft.date,
    meal: draft.meal,
    description: draft.description.trim(),
    kcal: roundOrNull(draft.kcal),
    carbs_g: roundOrNull(draft.carbsG),
    protein_g: roundOrNull(draft.proteinG),
    fat_g: roundOrNull(draft.fatG),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: oneOfOr(row.type, NOTIFICATION_TYPES, 'plan_updated'),
    title: row.title,
    body: row.body ?? '',
    data: recordOrEmpty(row.data),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function notificationToRow(n: AppNotification): NotificationRow {
  return {
    id: n.id,
    user_id: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    read_at: n.readAt,
    created_at: n.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Plan proposals
// ---------------------------------------------------------------------------

export function rowToProposal(row: ProposalRow): PlanProposal {
  return {
    id: row.id,
    userId: row.user_id,
    kind: oneOfOr(row.kind, PROPOSAL_KINDS, 'replan'),
    source: oneOfOr(row.source, PROPOSAL_SOURCES, 'rules'),
    weekStart: row.week_start,
    summary: row.summary ?? '',
    changes: parsePlanChanges(row.changes),
    status: oneOfOr(row.status, PROPOSAL_STATUSES, 'pending'),
    model: row.model,
    createdAt: row.created_at,
  };
}

export function proposalToRow(p: PlanProposal): ProposalRow {
  return {
    id: p.id,
    user_id: p.userId,
    kind: p.kind,
    source: p.source,
    week_start: p.weekStart,
    summary: p.summary,
    changes: p.changes,
    status: p.status,
    model: p.model,
    created_at: p.createdAt,
  };
}

export function proposalDraftToInsert(draft: ProposalDraft, userId: string): Row {
  return {
    user_id: userId,
    kind: draft.kind,
    source: draft.source,
    week_start: draft.weekStart,
    summary: draft.summary.slice(0, 4000),
    changes: draft.changes,
    model: draft.model ?? null,
  };
}
