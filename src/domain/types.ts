/**
 * Core domain model for Rebufo.
 *
 * This module is PURE TypeScript: no React, React Native or Expo imports, so it
 * can be shared by the app, the demo repository and unit tests.
 *
 * Conventions
 * - Dates are local calendar dates as 'YYYY-MM-DD' (ISODate). Weeks start on Monday.
 * - Times are local wall-clock 'HH:mm' (ISOTime).
 * - Timestamps are full ISO-8601 strings (ISODateTime).
 * - Weekday indexes are 0 = Monday … 6 = Sunday (see `Weekday`).
 * - Durations are minutes, distances metres, paces seconds.
 */

export type UUID = string;
export type ISODate = string;
export type ISOTime = string;
export type ISODateTime = string;

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DateRange {
  /** Inclusive start date. */
  from: ISODate;
  /** Inclusive end date. */
  to: ISODate;
}

// ---------------------------------------------------------------------------
// Sports & intensity
// ---------------------------------------------------------------------------

export const SPORTS = ['swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other', 'rest'] as const;
export type Sport = (typeof SPORTS)[number];

/** Sports a user can declare they practise (rest is not a sport). */
export const TRAINABLE_SPORTS = ['swim', 'bike', 'run', 'strength', 'mobility'] as const;
export type TrainableSport = (typeof TRAINABLE_SPORTS)[number];

/**
 * Session intensity, ordered easy → hard. Roughly maps to a 5-zone model:
 * recovery=Z1, endurance=Z2, tempo=Z3, threshold=Z4, vo2=Z5, race=race pace.
 */
export const INTENSITIES = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race'] as const;
export type Intensity = (typeof INTENSITIES)[number];

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export type WorkoutStatus = 'planned' | 'completed' | 'skipped';

/** Who created / last planned the workout. */
export const WORKOUT_SOURCES = ['manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin'] as const;
export type WorkoutSource = (typeof WORKOUT_SOURCES)[number];

export type WorkoutStepKind = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'rest';

export interface WorkoutStep {
  kind: WorkoutStepKind;
  durationMin?: number;
  distanceM?: number;
  intensity?: Intensity;
  /** Repeat this step N times (intervals). */
  repeat?: number;
  note?: string;
}

export interface CompletedData {
  durationMin?: number;
  distanceM?: number;
  avgHr?: number;
  /** Rate of perceived exertion 1–10. */
  rpe?: number;
  tss?: number;
  notes?: string;
  source?: 'manual' | 'healthkit' | 'garmin' | 'claude';
  /** Id of the matched activity in the source system (e.g. HealthKit UUID). */
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
  /** Planned TSS. When null, estimate with domain/load.estimateTss. */
  tss: number | null;
  steps: WorkoutStep[];
  status: WorkoutStatus;
  completed: CompletedData | null;
  source: WorkoutSource;
  /** Key session of the week: protected by the re-planner. */
  isKey: boolean;
  jointSessionId: UUID | null;
  /** Id of the imported activity (Garmin / HealthKit) for unplanned workouts; dedupe key. */
  externalId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Fields accepted when creating a workout (plan changes, editor, AI, MCP). */
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

export type WorkoutPatch = Partial<WorkoutDraft> & {
  status?: WorkoutStatus;
  completed?: CompletedData | null;
};

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

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
export type RacePriority = 'A' | 'B' | 'C';

export interface Race {
  id: UUID;
  userId: UUID;
  name: string;
  date: ISODate;
  distance: RaceDistance;
  priority: RacePriority;
  location: string | null;
  /** Free text goal, e.g. "sub 5h" or "terminar". */
  goal: string | null;
  notes: string | null;
  createdAt: ISODateTime;
}

export interface RaceDraft {
  name: string;
  date: ISODate;
  distance: RaceDistance;
  priority: RacePriority;
  location?: string | null;
  goal?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Life events ("imprevistos")
// ---------------------------------------------------------------------------

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

/** 1 = low, 2 = medium, 3 = high (intensity for sports, severity for injuries/stress). */
export type Severity = 1 | 2 | 3;

export interface LifeEvent {
  id: UUID;
  userId: UUID;
  kind: LifeEventKind;
  title: string;
  startDate: ISODate;
  /** Inclusive. Same as startDate for one-off events. */
  endDate: ISODate;
  startTime: ISOTime | null;
  durationMin: number | null;
  severity: Severity;
  bodyArea: BodyArea | null;
  notes: string | null;
  createdAt: ISODateTime;
}

export interface LifeEventDraft {
  kind: LifeEventKind;
  title: string;
  startDate: ISODate;
  endDate?: ISODate;
  startTime?: ISOTime | null;
  durationMin?: number | null;
  severity: Severity;
  bodyArea?: BodyArea | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Availability / busy time
// ---------------------------------------------------------------------------

export type BusySource = 'device_calendar' | 'manual';

export interface BusyBlock {
  id: UUID;
  userId: UUID;
  start: ISODateTime;
  end: ISODateTime;
  source: BusySource;
  /** Private: never shown to friends. */
  title: string | null;
  externalId: string | null;
}

export interface BusyBlockDraft {
  start: ISODateTime;
  end: ISODateTime;
  source: BusySource;
  title?: string | null;
  externalId?: string | null;
}

export interface TrainingWindow {
  weekday: Weekday;
  start: ISOTime;
  end: ISOTime;
}

export interface Availability {
  /** Target training hours per (normal, non-recovery) week. */
  weeklyHoursTarget: number;
  /** Preferred full rest day, null = no fixed rest day. */
  restDay: Weekday | null;
  /** Days where long sessions fit (usually Sat/Sun). */
  longSessionDays: Weekday[];
  /** Usual windows when the athlete can train. */
  windows: TrainingWindow[];
  /** Days with pool access. Empty = any day. */
  poolDays: Weekday[];
}

// ---------------------------------------------------------------------------
// Wellness
// ---------------------------------------------------------------------------

/** 1 = very bad … 5 = very good (for fatigue/soreness/stress: 1 = none … 5 = extreme). */
export type Score5 = 1 | 2 | 3 | 4 | 5;

export interface DailyCheckin {
  userId: UUID;
  date: ISODate;
  sleepQuality: Score5;
  sleepHours: number | null;
  fatigue: Score5;
  soreness: Score5;
  stress: Score5;
  motivation: Score5;
  notes: string | null;
}

export type CheckinDraft = Omit<DailyCheckin, 'userId'>;

export type MetricsSource = 'healthkit' | 'garmin' | 'manual';

export interface DailyMetrics {
  userId: UUID;
  date: ISODate;
  source: MetricsSource;
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

export type MetricsDraft = Omit<DailyMetrics, 'userId'>;

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre', 'during', 'post'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export interface NutritionLog {
  id: UUID;
  userId: UUID;
  date: ISODate;
  meal: MealSlot;
  description: string;
  kcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  createdAt: ISODateTime;
}

export interface NutritionDraft {
  date: ISODate;
  meal: MealSlot;
  description: string;
  kcal?: number | null;
  carbsG?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** What friends can see of my calendar. */
export type CalendarVisibility = 'full' | 'summary' | 'busy';
export type AthleteLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Thresholds {
  ftpW?: number;
  runThresholdPaceSecPerKm?: number;
  swimCssSecPer100m?: number;
  maxHr?: number;
  lthr?: number;
  restingHr?: number;
}

export interface NotificationPrefs {
  workoutReminders: boolean;
  reminderMinutesBefore: number;
  morningSummary: boolean;
  morningTime: ISOTime;
  eveningCheckin: boolean;
  eveningTime: ISOTime;
  weeklyPlanReminder: boolean;
  social: boolean;
}

export interface Profile {
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  sports: TrainableSport[];
  level: AthleteLevel;
  thresholds: Thresholds;
  availability: Availability;
  visibility: CalendarVisibility;
  notificationPrefs: NotificationPrefs;
  timezone: string;
  /** Free text the coach should always know (diet, preferences, history). */
  coachNotes: string | null;
  onboardedAt: ISODateTime | null;
  /** When the user explicitly agreed to send their training/health context to Anthropic (Coach IA). */
  aiConsentAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'createdAt'>>;

export interface PublicProfile {
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  sports: TrainableSport[];
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export interface Friend {
  friendshipId: UUID;
  profile: PublicProfile;
  status: FriendshipStatus;
  /** incoming = they asked me; outgoing = I asked them; mutual = accepted. */
  direction: 'incoming' | 'outgoing' | 'mutual';
  /** What the friend shares with me (null until the friendship is accepted). */
  visibility: CalendarVisibility | null;
  createdAt: ISODateTime;
}

/**
 * A friend's calendar entry, already masked server-side according to the
 * friend's `visibility`:
 * - full: everything below is filled.
 * - summary: sport, durationMin, intensity, times; title/description null.
 * - busy: kind 'busy' only, with times.
 */
export interface FriendWeekItem {
  kind: 'workout' | 'busy' | 'event';
  id: UUID | null;
  date: ISODate;
  startTime: ISOTime | null;
  /** For busy blocks: end time on the same date (blocks are split per day). */
  endTime: ISOTime | null;
  durationMin: number | null;
  sport: Sport | null;
  intensity: Intensity | null;
  title: string | null;
  status: WorkoutStatus | null;
  jointSessionId: UUID | null;
}

export type JointStatus = 'proposed' | 'confirmed' | 'cancelled';
export type ParticipantStatus = 'invited' | 'accepted' | 'declined';

export interface JointParticipant {
  userId: UUID;
  displayName: string;
  avatarUrl: string | null;
  status: ParticipantStatus;
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
  notes: string | null;
  status: JointStatus;
  participants: JointParticipant[];
  createdAt: ISODateTime;
}

export interface JointSessionDraft {
  sport: Sport;
  date: ISODate;
  startTime?: ISOTime | null;
  durationMin: number;
  intensity: Intensity;
  title: string;
  location?: string | null;
  notes?: string | null;
  inviteeIds: UUID[];
  /** Link the organizer's existing workout instead of creating a new one. */
  fromWorkoutId?: UUID | null;
}

export type FeedEventType = 'workout_completed' | 'race_added' | 'joint_confirmed' | 'plan_updated';

export interface FeedItem {
  id: UUID;
  actor: PublicProfile;
  type: FeedEventType;
  /** Shape depends on type, e.g. { sport, title, durationMin } for workout_completed. */
  payload: Record<string, unknown>;
  createdAt: ISODateTime;
  kudosCount: number;
  hasKudoed: boolean;
}

// ---------------------------------------------------------------------------
// Notifications (in-app inbox; also delivered as push)
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'joint_invite',
  'joint_response',
  'joint_cancelled',
  'plan_updated',
  'friend_completed',
  'kudos',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link data, e.g. { jointSessionId } or { url: '/joint/123' }. */
  data: Record<string, unknown>;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Planning: changes & proposals (shared by rules engine, AI coach and Claude MCP)
// ---------------------------------------------------------------------------

export type PlanChange =
  | { op: 'add'; workout: WorkoutDraft; reason: string }
  | { op: 'update'; workoutId: UUID; patch: Partial<WorkoutDraft>; reason: string }
  | { op: 'move'; workoutId: UUID; toDate: ISODate; toStartTime?: ISOTime | null; reason: string }
  | { op: 'delete'; workoutId: UUID; reason: string };

export type ProposalKind = 'generate_week' | 'replan' | 'chat';
export type ProposalSource = 'rules' | 'ai_coach' | 'claude';
export type ProposalStatus = 'pending' | 'applied' | 'partially_applied' | 'discarded';

export interface PlanProposal {
  id: UUID;
  userId: UUID;
  kind: ProposalKind;
  source: ProposalSource;
  weekStart: ISODate;
  /** Short human summary (Spanish) of what the proposal does and why. */
  summary: string;
  changes: PlanChange[];
  status: ProposalStatus;
  model: string | null;
  createdAt: ISODateTime;
}

export interface ProposalDraft {
  kind: ProposalKind;
  source: ProposalSource;
  weekStart: ISODate;
  summary: string;
  changes: PlanChange[];
  model?: string | null;
}

export interface ApplyResult {
  applied: number;
  failed: { index: number; error: string }[];
  workouts: Workout[];
}

// ---------------------------------------------------------------------------
// Coach (AI) requests
// ---------------------------------------------------------------------------

export type CoachMode = 'plan_week' | 'replan' | 'chat';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachRequest {
  mode: CoachMode;
  /** Monday of the target week. */
  weekStart: ISODate;
  /** Free text from the athlete: "esta semana tengo exámenes", "me duele la rodilla"… */
  message?: string;
  /** Previous chat turns (mode 'chat'). */
  history?: CoachMessage[];
  /** Life event that triggered a replan. */
  lifeEventId?: UUID;
  /** Consider aligning sessions with these friends. */
  friendIds?: UUID[];
}

export interface CoachResponse {
  /** Assistant reply in Spanish (always present). */
  reply: string;
  /** Present for plan_week / replan (and chat when the coach proposes changes). */
  proposal: PlanProposal | null;
  /** 'ai' when Claude answered, 'rules' when the deterministic engine did (offline/demo/fallback). */
  engine: 'ai' | 'rules';
}

// ---------------------------------------------------------------------------
// External integrations (Garmin Personal API, HealthKit, device calendar)
// ---------------------------------------------------------------------------

export type IntegrationProvider = 'garmin_personal';
export type IntegrationState = 'connected' | 'error' | 'expired' | 'disconnected';

export interface IntegrationStatus {
  provider: IntegrationProvider;
  state: IntegrationState;
  /** When the user-provided key expires (Garmin keys last 30 days–1 year). */
  expiresAt: ISODate | null;
  lastSyncAt: ISODateTime | null;
  lastError: string | null;
}

export interface SyncResult {
  metricsDays: number;
  activitiesImported: number;
  workoutsCompleted: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Personal tokens (Claude connector / ICS feed)
// ---------------------------------------------------------------------------

export type TokenScope = 'mcp' | 'ics';

export interface PersonalToken {
  id: UUID;
  scope: TokenScope;
  label: string;
  /** First chars of the secret, for display ("tdm_ab12…"). */
  prefix: string;
  createdAt: ISODateTime;
  lastUsedAt: ISODateTime | null;
  revokedAt: ISODateTime | null;
}

export interface CreatedToken {
  token: PersonalToken;
  /** Plain secret, shown ONCE. */
  secret: string;
  /** Ready-to-paste URL (MCP connector URL or ICS feed URL). */
  url: string;
}
