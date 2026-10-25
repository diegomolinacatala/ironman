/**
 * In-memory database of the demo repository. Treated as immutable: every
 * operation returns a new `DemoDb` (arrays/objects are replaced, never
 * mutated). Persisted as JSON in AsyncStorage (`StorageKeys.demoDb`).
 */
import type {
  AppNotification,
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  FeedEventType,
  FriendshipStatus,
  IntegrationStatus,
  ISODate,
  ISODateTime,
  JointSession,
  LifeEvent,
  NutritionLog,
  ParticipantStatus,
  PersonalToken,
  PlanProposal,
  Profile,
  Race,
  UUID,
  Workout,
} from '@/domain/types';

export const DEMO_DB_VERSION = 1;

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
  feed: DemoFeedEvent[];
  kudos: DemoKudos[];
  notifications: AppNotification[];
  pushTokens: DemoPushToken[];
  proposals: PlanProposal[];
  tokens: DemoToken[];
  integrations: DemoIntegration[];
}

/** Clock + id factory injected into pure demo operations. */
export interface DemoClock {
  now: ISODateTime;
  today: ISODate;
  newId: () => UUID;
}

export function isDemoDb(value: unknown): value is DemoDb {
  if (typeof value !== 'object' || value === null) return false;
  const db = value as Partial<DemoDb>;
  return (
    db.version === DEMO_DB_VERSION &&
    typeof db.meId === 'string' &&
    Array.isArray(db.profiles) &&
    Array.isArray(db.workouts) &&
    Array.isArray(db.jointSessions) &&
    Array.isArray(db.notifications)
  );
}

export function profileOf(db: DemoDb, id: UUID): Profile | null {
  return db.profiles.find((p) => p.id === id) ?? null;
}
