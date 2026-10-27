/**
 * Data-access ports used by the pure planning/MCP/coach logic. The Supabase
 * implementation lives in `_shared/platform/` (service-role client; EVERY
 * query filters by the resolved user id). Tests use in-memory fakes.
 */
import type {
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  FriendSummary,
  FriendWeekItem,
  ISODate,
  ISODateTime,
  JointSession,
  LifeEvent,
  LifeEventKind,
  NutritionLog,
  PlanChange,
  Profile,
  ProposalDraft,
  Race,
  RaceDistance,
  RacePriority,
  UUID,
  Workout,
  BodyArea,
  CompletedData,
  Intensity,
  Sport,
} from '../types.ts';

export interface PlanningReader {
  getProfile(userId: UUID): Promise<Profile | null>;
  listWorkouts(userId: UUID, from: ISODate, to: ISODate): Promise<Workout[]>;
  listRaces(userId: UUID): Promise<Race[]>;
  /** Events overlapping [from, to]. */
  listLifeEvents(userId: UUID, from: ISODate, to: ISODate): Promise<LifeEvent[]>;
  /** Blocks starting in [fromIso, toIso). */
  listBusyBlocks(userId: UUID, fromIso: ISODateTime, toIso: ISODateTime): Promise<BusyBlock[]>;
  listCheckins(userId: UUID, from: ISODate, to: ISODate): Promise<DailyCheckin[]>;
  listMetrics(userId: UUID, from: ISODate, to: ISODate): Promise<DailyMetrics[]>;
  listNutrition(userId: UUID, from: ISODate, to: ISODate): Promise<NutritionLog[]>;
  /** Joint sessions (quedadas) the user takes part in, dated in [from, to]. */
  listJointSessions(userId: UUID, from: ISODate, to: ISODate): Promise<JointSession[]>;
  /** Accepted friends only. */
  listFriends(userId: UUID): Promise<FriendSummary[]>;
  /** Friend's calendar masked by their visibility (svc_get_friend_week). */
  getFriendWeek(viewerId: UUID, friendId: UUID, from: ISODate, to: ISODate): Promise<FriendWeekItem[]>;
}

export interface ApplyChangesResult {
  applied: number;
  failed: { index: number; error: string }[];
}

export interface LifeEventInsert {
  kind: LifeEventKind;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  startTime: string | null;
  durationMin: number | null;
  severity: 1 | 2 | 3;
  bodyArea: BodyArea | null;
  notes: string | null;
}

/** Only the defined keys are written (merge semantics on (user, date, source)). */
export interface MetricsUpsert {
  date: ISODate;
  hrvMs?: number;
  restingHr?: number;
  sleepHours?: number;
  sleepScore?: number;
  bodyBattery?: number;
  trainingReadiness?: number;
  vo2max?: number;
  steps?: number;
  stressAvg?: number;
  trainingStatus?: string;
  /** Sleep stages (minutes) and start/end instants of the night that ends on `date`. */
  sleepDeepMin?: number;
  sleepLightMin?: number;
  sleepRemMin?: number;
  sleepAwakeMin?: number;
  sleepStart?: ISODateTime;
  sleepEnd?: ISODateTime;
  raw: Record<string, unknown>;
}

export interface CompletedWorkoutInsert {
  date: ISODate;
  startTime: string | null;
  sport: Sport;
  title: string;
  durationMin: number;
  distanceM: number | null;
  intensity: Intensity;
  completed: CompletedData;
  source: 'garmin' | 'claude';
  externalId: string | null;
}

export interface RaceWrite {
  name?: string;
  date?: ISODate;
  distance?: RaceDistance;
  priority?: RacePriority;
  location?: string | null;
  goal?: string | null;
  notes?: string | null;
}

export interface PlanningWriter {
  insertProposal(userId: UUID, draft: ProposalDraft): Promise<UUID>;
  applyPlanChanges(userId: UUID, changes: PlanChange[], proposalId: UUID): Promise<ApplyChangesResult>;
  insertLifeEvent(userId: UUID, event: LifeEventInsert): Promise<LifeEvent>;
  upsertMetrics(userId: UUID, source: 'garmin', rows: MetricsUpsert[]): Promise<number>;
  /** Marks a planned workout completed. Returns false when it was not planned/owned. */
  completeWorkout(userId: UUID, workoutId: UUID, completed: CompletedData): Promise<boolean>;
  /** Finds a workout already linked to an external activity (external_id or completed.externalId). */
  findByExternalId(userId: UUID, externalId: string, rawId: string): Promise<Workout | null>;
  /** Inserts a completed (unplanned) workout; returns null if the external id already exists. */
  insertCompletedWorkout(userId: UUID, row: CompletedWorkoutInsert): Promise<Workout | null>;
  insertRace(userId: UUID, race: Required<Pick<RaceWrite, 'name' | 'date' | 'distance' | 'priority'>> & RaceWrite): Promise<Race>;
  updateRace(userId: UUID, raceId: UUID, patch: RaceWrite): Promise<Race | null>;
}

export type PlanningStore = PlanningReader & PlanningWriter;
