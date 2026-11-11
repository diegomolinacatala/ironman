/**
 * In-memory database of the demo repository. Treated as immutable: every
 * operation returns a new `DemoDb` (arrays/objects are replaced, never
 * mutated). Persisted as JSON in AsyncStorage (`StorageKeys.demoDb`).
 */
import type {
  AppNotification,
  Briefing,
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  FeedEventType,
  FriendshipStatus,
  IntegrationStatus,
  ISODate,
  ISODateTime,
  JointComment,
  JointSession,
  LifeEvent,
  NutritionLog,
  ParticipantStatus,
  PersonalToken,
  PlanProposal,
  Profile,
  Race,
  UUID,
  WeekPlan,
  Workout,
} from '@/domain/types';

/**
 * v2: sleep stages in the seed, `briefings`, Diego not onboarded (the v2 onboarding runs once).
 * v3: open quedadas, `jointComments`.
 * v4: season plan (`weekPlans`); a v3 database is migrated in place, never re-seeded.
 */
export const DEMO_DB_VERSION = 4;

export interface DemoFriendship {
  id: UUID;
  requesterId: UUID;
  addresseeId: UUID;
  status: FriendshipStatus;
  createdAt: ISODateTime;
  respondedAt: ISODateTime | null;
}

export interface DemoParticipant {
  userId: UUID;
  status: ParticipantStatus;
  workoutId: UUID | null;
  respondedAt: ISODateTime | null;
}

export interface DemoJointSession extends Omit<JointSession, 'participants'> {
  participants: DemoParticipant[];
}

export interface DemoFeedEvent {
  id: UUID;
  actorId: UUID;
  type: FeedEventType;
  payload: Record<string, unknown>;
  createdAt: ISODateTime;
}

export interface DemoKudos {
  eventId: UUID;
  userId: UUID;
  createdAt: ISODateTime;
}

export interface DemoPushToken {
  token: string;
  userId: UUID;
  platform: 'ios' | 'android' | 'web';
  lastSeenAt: ISODateTime;
}

export interface DemoToken extends PersonalToken {
  userId: UUID;
}

export interface DemoIntegration extends IntegrationStatus {
  userId: UUID;
}

export interface DemoBriefing extends Briefing {
  userId: UUID;
}

export interface DemoWeekPlan extends WeekPlan {
  userId: UUID;
}

export interface DemoDb {
  version: number;
  /** "Today" when the data was seeded (all seed dates are relative to it). */
  seededOn: ISODate;
  /** The signed-in demo athlete (Diego). */
  meId: UUID;
  profiles: Profile[];
  workouts: Workout[];
  races: Race[];
  lifeEvents: LifeEvent[];
  busyBlocks: BusyBlock[];
  checkins: DailyCheckin[];
  metrics: DailyMetrics[];
  nutrition: NutritionLog[];
  friendships: DemoFriendship[];
  jointSessions: DemoJointSession[];
  jointComments: JointComment[];
  feed: DemoFeedEvent[];
  kudos: DemoKudos[];
  notifications: AppNotification[];
  pushTokens: DemoPushToken[];
  proposals: PlanProposal[];
  tokens: DemoToken[];
  integrations: DemoIntegration[];
  briefings: DemoBriefing[];
  /** Season plan overrides ("Plan → General"), one per (user, Monday). */
  weekPlans: DemoWeekPlan[];
}

/** Clock + id factory injected into pure demo operations. */
export interface DemoClock {
  now: ISODateTime;
  today: ISODate;
  newId: () => UUID;
}

/** Collections every database since v3 has (the shape a migration can start from). */
function hasV3Shape(db: Partial<DemoDb>): boolean {
  return (
    typeof db.meId === 'string' &&
    Array.isArray(db.profiles) &&
    Array.isArray(db.workouts) &&
    Array.isArray(db.jointSessions) &&
    Array.isArray(db.jointComments) &&
    Array.isArray(db.notifications) &&
    Array.isArray(db.briefings)
  );
}

export function isDemoDb(value: unknown): value is DemoDb {
  if (typeof value !== 'object' || value === null) return false;
  const db = value as Partial<DemoDb>;
  return db.version === DEMO_DB_VERSION && hasV3Shape(db) && Array.isArray(db.weekPlans);
}

/**
 * Brings an older stored database up to the current version, keeping every
 * row (the athlete's own workouts, check-ins, quedadas…). Null when it cannot
 * be migrated (too old or malformed): the caller seeds a new one.
 * - v3 → v4: adds an empty season plan.
 */
export function migrateDemoDb(value: unknown): DemoDb | null {
  if (typeof value !== 'object' || value === null) return null;
  const db = value as Partial<DemoDb>;
  if (db.version !== 3 || !hasV3Shape(db)) return null;
  return { ...(db as DemoDb), version: DEMO_DB_VERSION, weekPlans: [] };
}

export function profileOf(db: DemoDb, id: UUID): Profile | null {
  return db.profiles.find((p) => p.id === id) ?? null;
}
