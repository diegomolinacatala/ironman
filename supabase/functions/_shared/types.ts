/**
 * Domain types used by the edge functions.
 *
 * MIRROR of `src/domain/types.ts` (the app contract). Edge functions are
 * bundled on their own (Deno, `--use-api`), so they cannot import from `src/`.
 * Keep names and shapes identical: plan changes are stored as camelCase JSON
 * that the app reads back verbatim.
 */

export type UUID = string;
export type ISODate = string;
export type ISOTime = string;
export type ISODateTime = string;

export const SPORTS = ['swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other', 'rest'] as const;
export type Sport = (typeof SPORTS)[number];

export const INTENSITIES = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race'] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const WORKOUT_STATUSES = ['planned', 'completed', 'skipped'] as const;
export type WorkoutStatus = (typeof WORKOUT_STATUSES)[number];

export const WORKOUT_SOURCES = ['manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin'] as const;
export type WorkoutSource = (typeof WORKOUT_SOURCES)[number];

export const STEP_KINDS = ['warmup', 'work', 'recovery', 'cooldown', 'rest'] as const;
export type WorkoutStepKind = (typeof STEP_KINDS)[number];

export interface WorkoutStep {
  kind: WorkoutStepKind;
  durationMin?: number;
  distanceM?: number;
  intensity?: Intensity;
  repeat?: number;
  note?: string;
}

export interface CompletedData {
  durationMin?: number;
  distanceM?: number;
  avgHr?: number;
  rpe?: number;
  tss?: number;
  notes?: string;
  source?: 'manual' | 'healthkit' | 'garmin' | 'claude';
  externalId?: string;
  completedAt?: ISODateTime;
}

export interface Workout {
  id: UUID;
  userId: UUID;
  date: ISODate;
  startTime: ISOTime | null;
  sport: Sport;
  title: string;
  description: string | null;
  durationMin: number;
  distanceM: number | null;
  intensity: Intensity;
  tss: number | null;
  steps: WorkoutStep[];
  status: WorkoutStatus;
  completed: CompletedData | null;
  source: WorkoutSource;
  isKey: boolean;
  jointSessionId: UUID | null;
  externalId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WorkoutDraft {
  date: ISODate;
  startTime?: ISOTime | null;
  sport: Sport;
  title: string;
  description?: string | null;
  durationMin: number;
  distanceM?: number | null;
  intensity: Intensity;
  tss?: number | null;
  steps?: WorkoutStep[];
  isKey?: boolean;
  source?: WorkoutSource;
  /** Imported activity id ('healthkit:<uuid>', 'garmin:<id>') — dedupe key for unplanned imports. */
  externalId?: string | null;
}

export const RACE_DISTANCES = [
  'sprint',
  'olympic',
  'half',
  'full',
  'run_5k',
  'run_10k',
  'run_half',
  'run_marathon',
  'other',
] as const;
export type RaceDistance = (typeof RACE_DISTANCES)[number];
export const RACE_PRIORITIES = ['A', 'B', 'C'] as const;
export type RacePriority = (typeof RACE_PRIORITIES)[number];

export interface Race {
  id: UUID;
  name: string;
  date: ISODate;
  distance: RaceDistance;
  priority: RacePriority;
  location: string | null;
  goal: string | null;
  notes: string | null;
}

export const LIFE_EVENT_KINDS = [
  'padel',
  'football',
  'other_sport',
  'injury',
  'illness',
  'overload',
  'work',
  'stress',
  'travel',
  'social',
  'exam',
  'other',
] as const;
export type LifeEventKind = (typeof LIFE_EVENT_KINDS)[number];

export const BODY_AREAS = [
  'foot',
  'ankle',
  'achilles',
  'calf',
  'shin',
  'knee',
  'hamstring',
  'quad',
  'hip',
  'back',
  'shoulder',
  'neck',
  'other',
] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

export interface LifeEvent {
  id: UUID;
  kind: LifeEventKind;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  startTime: ISOTime | null;
  durationMin: number | null;
  severity: 1 | 2 | 3;
  bodyArea: BodyArea | null;
  notes: string | null;
}

export interface BusyBlock {
  id: UUID;
  start: ISODateTime;
  end: ISODateTime;
  title: string | null;
}

export interface TrainingWindow {
  weekday: number;
  start: ISOTime;
  end: ISOTime;
}

export interface Availability {
  weeklyHoursTarget: number;
  restDay: number | null;
  longSessionDays: number[];
  windows: TrainingWindow[];
  poolDays: number[];
}

export interface Thresholds {
  ftpW?: number;
  runThresholdPaceSecPerKm?: number;
  swimCssSecPer100m?: number;
  maxHr?: number;
  lthr?: number;
  restingHr?: number;
}

export interface Profile {
  id: UUID;
  username: string;
  displayName: string;
  sports: string[];
  level: string;
  thresholds: Thresholds;
  availability: Availability;
  visibility: 'full' | 'summary' | 'busy';
  notificationPrefs: Record<string, unknown>;
  timezone: string;
  coachNotes: string | null;
}

export interface DailyCheckin {
  date: ISODate;
  sleepQuality: number;
  sleepHours: number | null;
  fatigue: number;
  soreness: number;
  stress: number;
  motivation: number;
  notes: string | null;
}

export interface DailyMetrics {
  date: ISODate;
  source: 'healthkit' | 'garmin' | 'manual';
  hrvMs: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  trainingReadiness: number | null;
  vo2max: number | null;
  steps: number | null;
  stressAvg: number | null;
  trainingStatus: string | null;
}

export interface NutritionLog {
  date: ISODate;
  meal: string;
  description: string;
  kcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
}

export interface FriendWeekItem {
  kind: 'workout' | 'busy' | 'event';
  id: UUID | null;
  date: ISODate;
  startTime: ISOTime | null;
  endTime: ISOTime | null;
  durationMin: number | null;
  sport: Sport | null;
  intensity: Intensity | null;
  title: string | null;
  status: WorkoutStatus | null;
  jointSessionId: UUID | null;
}

export interface FriendSummary {
  friendId: UUID;
  username: string;
  displayName: string;
}

export interface JointParticipant {
  userId: UUID;
  displayName: string;
  status: 'invited' | 'accepted' | 'declined';
  workoutId: UUID | null;
}

export interface JointSession {
  id: UUID;
  organizerId: UUID;
  sport: Sport;
  date: ISODate;
  startTime: ISOTime | null;
  durationMin: number;
  intensity: Intensity;
  title: string;
  location: string | null;
  status: 'proposed' | 'confirmed' | 'cancelled';
  participants: JointParticipant[];
}

export type PlanChange =
  | { op: 'add'; workout: WorkoutDraft; reason: string }
  | { op: 'update'; workoutId: UUID; patch: Partial<WorkoutDraft>; reason: string }
  | { op: 'move'; workoutId: UUID; toDate: ISODate; toStartTime?: ISOTime | null; reason: string }
  | { op: 'delete'; workoutId: UUID; reason: string };

export type ProposalKind = 'generate_week' | 'replan' | 'chat';
export type ProposalSource = 'rules' | 'ai_coach' | 'claude';

export interface ProposalDraft {
  kind: ProposalKind;
  source: ProposalSource;
  weekStart: ISODate;
  summary: string;
  changes: PlanChange[];
  model: string | null;
}

export const COACH_MODES = ['plan_week', 'replan', 'chat'] as const;
export type CoachMode = (typeof COACH_MODES)[number];

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachRequest {
  mode: CoachMode;
  weekStart: ISODate;
  message?: string;
  history?: CoachMessage[];
  lifeEventId?: UUID;
  friendIds?: UUID[];
}

export interface SyncResult {
  metricsDays: number;
  activitiesImported: number;
  workoutsCompleted: number;
  message: string;
}

export interface IntegrationStatus {
  provider: 'garmin_personal';
  state: 'connected' | 'error' | 'expired' | 'disconnected';
  expiresAt: ISODate | null;
  lastSyncAt: ISODateTime | null;
  lastError: string | null;
}
