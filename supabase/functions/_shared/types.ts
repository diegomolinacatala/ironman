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

export const WORKOUT_SOURCES = ['manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin', 'coros', 'imported'] as const;
export type WorkoutSource = (typeof WORKOUT_SOURCES)[number];

export const STEP_KINDS = ['warmup', 'work', 'recovery', 'cooldown', 'rest'] as const;
export type WorkoutStepKind = (typeof STEP_KINDS)[number];

/** Inclusive numeric range (heart rate, pace, power, RPE). */
export interface NumberRange {
  min: number;
  max: number;
}

/** Explicit step targets; absent = derived from intensity + thresholds (planning/domain/zones.ts). */
export interface StepTarget {
  /** Heart rate, ppm. */
  hr?: NumberRange;
  /** Pace: s/km (run) or s/100 m (swim); `min` is the faster end. */
  pace?: NumberRange;
  /** Power, watts. */
  power?: NumberRange;
  /** Perceived exertion, CR-10. */
  rpe?: NumberRange;
}

export interface WorkoutStep {
  kind: WorkoutStepKind;
  durationMin?: number;
  distanceM?: number;
  intensity?: Intensity;
  repeat?: number;
  note?: string;
  target?: StepTarget;
  /** How it should feel / what to focus on (≤ 200 chars). */
  cue?: string;
  /** Brick: the leg this step belongs to. */
  leg?: 'bike' | 'run';
}

/** The coach's prescription for a session (≤ 200 chars per text, ≤ 4 keys of ≤ 160). */
export interface WorkoutCoaching {
  objective: string;
  keys: string[];
  success: string;
  planB: string | null;
}

export interface CompletedData {
  durationMin?: number;
  distanceM?: number;
  avgHr?: number;
  /** Highest heart rate of the session (watch), ppm. */
  maxHr?: number;
  rpe?: number;
  /** Sensaciones after the session, 1 (muy mal) … 5 (genial). */
  feel?: number;
  tss?: number;
  /** Energy spent (watch), kcal. */
  kcal?: number;
  /** Average power (power meter), W. */
  avgPowerW?: number;
  /** Best 1-minute / 20-minute average power of the session (watch), W. */
  bestPower1MinW?: number;
  bestPower20MinW?: number;
  notes?: string;
  /** A manual completion takes the watch's source and id when the activity arrives (domain/watchCompletion.ts). */
  source?: 'manual' | 'healthkit' | 'garmin' | 'coros' | 'claude';
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
  coaching?: WorkoutCoaching | null;
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
  coaching?: WorkoutCoaching | null;
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
/** How a B/C race is prepared: training (como entreno), taper (solo afinar), specific (preparación específica). */
export const RACE_PREPS = ['training', 'taper', 'specific'] as const;
export type RacePrep = (typeof RACE_PREPS)[number];

export interface Race {
  id: UUID;
  name: string;
  date: ISODate;
  distance: RaceDistance;
  priority: RacePriority;
  location: string | null;
  goal: string | null;
  notes: string | null;
  /** B/C races: how it is prepared; null or absent = the priority's default (B taper, C training). A races ignore it. */
  prep?: RacePrep | null;
  /** When the race was added: anchors the macrocycle (planning/domain/periodization.ts). */
  createdAt?: ISODateTime;
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
  /** 'auto' (default, also when absent in the row) = the calendar decides; 'manual' = the fields below. */
  mode?: 'auto' | 'manual';
  /** Manual mode only. */
  weeklyHoursTarget: number;
  restDay: number | null;
  longSessionDays: number[];
  windows: TrainingWindow[];
  poolDays: number[];
}

export type AthleteLevel = 'beginner' | 'intermediate' | 'advanced';
export const TRAINABLE_SPORTS = ['swim', 'bike', 'run', 'strength', 'mobility'] as const;
export type TrainableSport = (typeof TRAINABLE_SPORTS)[number];

export const WATCH_BRANDS = ['garmin', 'coros'] as const;
export type WatchBrand = (typeof WATCH_BRANDS)[number];

export interface Thresholds {
  ftpW?: number;
  runThresholdPaceSecPerKm?: number;
  swimCssSecPer100m?: number;
  maxHr?: number;
  lthr?: number;
  restingHr?: number;
}

/** «Tu forma de entrenar»: how the intensity of the week is distributed. */
export type IntensityModel = 'auto' | 'polarized' | 'pyramidal';

/** Sports the athlete can set sessions and days for in «Tu forma de entrenar». */
export type PrefSport = 'swim' | 'bike' | 'run' | 'strength';

/** A session the athlete does every week (club swim on Tuesdays at 20:00…): the planner plans around it. */
export interface FixedWeeklySession {
  sport: PrefSport;
  /** 0 = Monday … 6 = Sunday. */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 'HH:MM', null = any time of the day. */
  startTime: ISOTime | null;
  durationMin: number;
  title: string;
}

/**
 * «Tu forma de entrenar» (`profiles.training_prefs`): everything optional,
 * absent = «Automático» (the planner's own choice).
 */
export interface TrainingPrefs {
  /** Sessions per week per sport; a missing sport = automático. */
  sessionsPerWeek: Partial<Record<PrefSport, number>>;
  /** Preferred weekdays per sport (0 = Monday); missing or empty = any day. */
  preferredDays: Partial<Record<PrefSport, (0 | 1 | 2 | 3 | 4 | 5 | 6)[]>>;
  /** Days for the long ride / the long run; empty = automático (the long-session days). */
  longRideDays: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  longRunDays: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  intensityModel: IntensityModel;
  fixedSessions: FixedWeeklySession[];
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
  /** The athlete's watch (null = not chosen, treated as Garmin). */
  watchBrand?: WatchBrand | null;
  /** «Tu forma de entrenar» (`profiles.training_prefs`); null = everything automático. */
  trainingPrefs?: TrainingPrefs | null;
  /** «Tu contexto» (`profiles.athlete_context`); null = not told yet. */
  athleteContext?: AthleteContext | null;
}

/** «Tu contexto» (src/domain/types.ts): the endurance sports the coach asks about. */
export type ContextSport = 'swim' | 'bike' | 'run';
export type SportBackground = 'new' | 'some' | 'years' | 'lifelong';
export type SportGoal = 'maintain' | 'improve' | 'improve_lot';
export type Occupation = 'study' | 'work' | 'both' | 'none';
export type LifeLoad = 'light' | 'medium' | 'high';
export type WorkSchedule = 'morning' | 'afternoon' | 'full_day' | 'shifts' | 'flexible';
export type TrainingTimeOfDay = 'morning' | 'midday' | 'evening' | 'any';

export interface SportContext {
  background?: SportBackground;
  goal?: SportGoal;
}

export interface ContextPeriod {
  kind: 'exams' | 'busy';
  from: string;
  to: string;
  label: string;
  eventId: string | null;
}

export interface ContextHabits {
  breakfast: string | null;
  lunch: string | null;
  dinner: string | null;
  wake: string | null;
  bed: string | null;
  weekendsDiffer: boolean;
  weekendWake: string | null;
  weekendBed: string | null;
  preferredTime: TrainingTimeOfDay | null;
}

/** «Tu contexto» (`profiles.athlete_context`), same shape as the app's. */
export interface AthleteContext {
  sports: Partial<Record<ContextSport, SportContext>>;
  limitations: string | null;
  previousRaces: string | null;
  occupation: Occupation | null;
  load: LifeLoad | null;
  schedule: WorkSchedule | null;
  periods: ContextPeriod[];
  habits: ContextHabits;
  notes: string[];
  answered: string[];
  completedAt: string | null;
  promptDismissed: boolean;
}

/** Answer to the morning question shown when the night's breathing or pulse is up (domain/illness.ts). */
export const ILLNESS_ANSWERS = ['fine', 'symptoms', 'alcohol', 'heat', 'stress'] as const;
export type IllnessAnswer = (typeof ILLNESS_ANSWERS)[number];

/** Morning journal habits (mirror of src/domain/types.ts HABIT_IDS). */
export const HABIT_IDS = [
  'alcohol',
  'late_meal',
  'late_caffeine',
  'screens_in_bed',
  'hydration',
  'niggle',
  'sick',
  'mobility',
  'nap',
  'hard_workday',
  'travel',
  'other_sport',
  'enough_carbs',
  'ultra_processed',
  'regular_bedtime',
  'read_before_bed',
  'meditation',
  'daylight',
  'sauna',
  'cold_exposure',
] as const;
export type HabitId = (typeof HABIT_IDS)[number];
export type HabitAnswers = Partial<Record<HabitId, boolean>>;

/** Morning check-in: yes/no journal + optional 1–5 scales (null = not answered). */
export interface DailyCheckin {
  date: ISODate;
  sleepQuality: number | null;
  sleepHours: number | null;
  fatigue: number | null;
  soreness: number | null;
  stress: number | null;
  motivation: number | null;
  habits: HabitAnswers;
  notes: string | null;
  /** Absent/null = not asked. */
  illnessAnswer?: IllnessAnswer | null;
}

export interface DailyMetrics {
  date: ISODate;
  source: 'healthkit' | 'garmin' | 'coros' | 'manual';
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
  /** Sleep stages of the night that ENDS on `date` (Garmin), minutes. */
  sleepDeepMin?: number | null;
  sleepLightMin?: number | null;
  sleepRemMin?: number | null;
  sleepAwakeMin?: number | null;
  /** When that night's sleep started / ended (ISO instant). */
  sleepStart?: ISODateTime | null;
  sleepEnd?: ISODateTime | null;
  /** Average breathing rate (breaths/min) and heart rate (bpm) during that night. */
  sleepRespiration?: number | null;
  sleepAvgHr?: number | null;
}

export type SleepVerdict = 'great' | 'good' | 'fair' | 'poor' | 'unknown';
export const SLEEP_VERDICTS: readonly SleepVerdict[] = ['great', 'good', 'fair', 'poor', 'unknown'];

/** Last night's sleep and recovery, as shown on the briefing (all optional: Garmin may lack some). */
export interface SleepSnapshot {
  hours: number | null;
  score: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  start: ISODateTime | null;
  end: ISODateTime | null;
  hrvMs: number | null;
  /** Average HRV of the previous 7 nights (baseline), when known. */
  hrvBaselineMs: number | null;
  restingHr: number | null;
  /** Mean resting HR of the 7 previous nights, when known. */
  restingHrBaseline?: number | null;
  bodyBattery: number | null;
}

export interface Briefing {
  date: ISODate;
  headline: string;
  sleepVerdict: SleepVerdict;
  sleepSummary: string;
  script: string;
  focus: string;
  sleep: SleepSnapshot | null;
  engine: 'ai' | 'rules';
  createdAt: ISODateTime;
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre', 'during', 'post'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export interface MealAnalysis {
  meal: MealSlot;
  description: string;
  items: string[];
  kcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  confidence: 'high' | 'medium' | 'low';
  tip: string | null;
  engine: 'ai' | 'rules';
}

/** The coach's analysis of a completed session (mirror of the app's WorkoutAnalysis). */
export interface WorkoutAnalysis {
  workoutId: UUID;
  headline: string;
  wentWell: string[];
  improve: string[];
  nextStep: string;
  engine: 'ai' | 'rules';
  createdAt: ISODateTime;
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
  /** 'voice' when `message` is a speech transcript (may contain recognition errors). */
  channel?: 'voice' | 'text';
  /** 'context': «Tu contexto» › «¿Algo más que deba saber?» (chat): only listen, remember and ask; never changes. */
  topic?: 'context';
}

/** Quedada the coach suggests with a friend (camelCase, validated). Never sent: the app opens a prefilled form. */
export interface CoachQuedada {
  friendId: UUID;
  friendName: string;
  sport: Sport;
  date: ISODate;
  startTime: ISOTime | null;
  durationMin: number;
  intensity: Intensity;
  title: string;
  location: string | null;
  reason: string;
}

/** `coach_jobs.extras`: what the coach remembered, the imprevisto it logged, the quedada and the week plan it suggests. */
export interface CoachJobExtras {
  memory: string[];
  lifeEventId: UUID | null;
  quedada: CoachQuedada | null;
  /** Week-level plan suggested in chat (saved by the app only when the athlete taps). */
  weekPlans?: WeekPlanDraft[];
}

/** Week-level plan ("Plan → General"): overrides a prep/base/build week of the periodization. */
export const WEEK_PLAN_KINDS = ['load', 'push', 'recovery', 'rest'] as const;
export type WeekPlanKind = (typeof WEEK_PLAN_KINDS)[number];
export type WeekPlanSource = 'manual' | 'ai_coach' | 'claude';

export interface WeekPlan {
  weekStart: ISODate;
  kind: WeekPlanKind;
  targetMinutes: number | null;
  note: string | null;
  source: WeekPlanSource;
  updatedAt: ISODateTime;
}

export interface WeekPlanDraft {
  weekStart: ISODate;
  kind: WeekPlanKind;
  targetMinutes?: number | null;
  note?: string | null;
  source?: WeekPlanSource;
}

export interface SyncResult {
  metricsDays: number;
  activitiesImported: number;
  workoutsCompleted: number;
  message: string;
}

export interface IntegrationStatus {
  provider: 'garmin_personal' | 'coros_mcp';
  state: 'connected' | 'error' | 'expired' | 'disconnected';
  expiresAt: ISODate | null;
  lastSyncAt: ISODateTime | null;
  lastError: string | null;
}
