/**
 * Data-access contract. Screens never talk to Supabase directly: they use the
 * TanStack Query hooks in `./queries.ts`, which call a `Repository`.
 *
 * Two implementations:
 * - `supabase/SupabaseRepository` — real backend (auth, RLS, edge functions).
 * - `demo/DemoRepository` — local, AsyncStorage-backed, seeded with two demo
 *   athletes. Used when Supabase env vars are missing (web preview, first run).
 *
 * All methods act on behalf of the signed-in user. Errors are thrown as
 * `RepositoryError` with a user-facing Spanish message.
 */
import type {
  AppNotification,
  ApplyResult,
  BusyBlock,
  Briefing,
  BusyBlockDraft,
  CheckinDraft,
  CoachRequest,
  CoachResponse,
  CreatedToken,
  DailyCheckin,
  DailyMetrics,
  DateRange,
  FeedItem,
  Friend,
  FriendWeekItem,
  IntegrationStatus,
  JointSession,
  JointSessionDraft,
  LifeEvent,
  LifeEventDraft,
  MealAnalysis,
  MealAnalysisInput,
  MetricsDraft,
  NutritionDraft,
  NutritionLog,
  PersonalToken,
  PlanChange,
  PlanProposal,
  Profile,
  ProfilePatch,
  ProposalDraft,
  ProposalStatus,
  PublicProfile,
  Race,
  RaceDraft,
  SyncResult,
  TokenScope,
  UUID,
  Workout,
  WorkoutDraft,
  WorkoutPatch,
  CompletedData,
  ISODate,
} from '@/domain/types';

export type RepositoryMode = 'supabase' | 'demo';

export type RepositoryErrorCode =
  | 'not_authenticated'
  | 'not_found'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'network'
  | 'unavailable'
  | 'cancelled'
  | 'unknown';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly cause?: unknown;

  constructor(code: RepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.cause = cause;
  }
}

/** Tables whose changes trigger query invalidation. */
export type ChangeTopic =
  | 'workouts'
  | 'races'
  | 'life_events'
  | 'busy_blocks'
  | 'checkins'
  | 'metrics'
  | 'nutrition'
  | 'friends'
  | 'joint_sessions'
  | 'feed'
  | 'notifications'
  | 'proposals'
  | 'profile'
  | 'integrations'
  | 'briefings';

export interface AuthSession {
  userId: UUID;
  email: string | null;
}

export interface AuthApi {
  getSession(): Promise<AuthSession | null>;
  onAuthChange(listener: (session: AuthSession | null) => void): () => void;
  /** Sends a 6-digit code by email (Supabase OTP). */
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<AuthSession>;
  /**
   * Completes the sign-in from the link in the email (PKCE `code` received on
   * roadtoironman://auth/callback). Free Supabase projects send a link, not a code.
   */
  completeEmailLink(code: string): Promise<AuthSession>;
  /** Native Sign in with Apple (iOS). Throws 'unavailable' elsewhere. */
  signInWithApple(): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** Permanently deletes the account and all its data (App Store requirement). */
  deleteAccount(): Promise<void>;
}

export interface Repository {
  readonly mode: RepositoryMode;
  readonly auth: AuthApi;

  // Profile ------------------------------------------------------------------
  getMyProfile(): Promise<Profile | null>;
  /** Creates the profile on first call (onboarding), patches afterwards. */
  upsertMyProfile(patch: ProfilePatch): Promise<Profile>;
  isUsernameAvailable(username: string): Promise<boolean>;

  // Workouts -----------------------------------------------------------------
  listWorkouts(range: DateRange): Promise<Workout[]>;
  getWorkout(id: UUID): Promise<Workout | null>;
  createWorkout(draft: WorkoutDraft): Promise<Workout>;
  updateWorkout(id: UUID, patch: WorkoutPatch): Promise<Workout>;
  deleteWorkout(id: UUID): Promise<void>;
  completeWorkout(id: UUID, data: CompletedData): Promise<Workout>;
  skipWorkout(id: UUID, reason?: string): Promise<Workout>;
  /** Re-opens a completed/skipped workout. */
  resetWorkout(id: UUID): Promise<Workout>;
  /** Applies changes atomically-ish (failures reported per change). Marks the proposal applied when given. */
  applyPlanChanges(changes: PlanChange[], proposalId?: UUID): Promise<ApplyResult>;

  // Races --------------------------------------------------------------------
  listRaces(): Promise<Race[]>;
  createRace(draft: RaceDraft): Promise<Race>;
  updateRace(id: UUID, patch: Partial<RaceDraft>): Promise<Race>;
  deleteRace(id: UUID): Promise<void>;

  // Life events --------------------------------------------------------------
  listLifeEvents(range: DateRange): Promise<LifeEvent[]>;
  createLifeEvent(draft: LifeEventDraft): Promise<LifeEvent>;
  updateLifeEvent(id: UUID, patch: Partial<LifeEventDraft>): Promise<LifeEvent>;
  deleteLifeEvent(id: UUID): Promise<void>;

  // Busy blocks (classes, work…) ---------------------------------------------
  listBusyBlocks(range: DateRange): Promise<BusyBlock[]>;
  /** Replaces all blocks of `source` overlapping `range` (calendar sync). */
  replaceBusyBlocks(range: DateRange, source: BusyBlockDraft['source'], blocks: BusyBlockDraft[]): Promise<BusyBlock[]>;
  createBusyBlock(draft: BusyBlockDraft): Promise<BusyBlock>;
  deleteBusyBlock(id: UUID): Promise<void>;

  // Wellness -----------------------------------------------------------------
  listCheckins(range: DateRange): Promise<DailyCheckin[]>;
  upsertCheckin(draft: CheckinDraft): Promise<DailyCheckin>;
  listMetrics(range: DateRange): Promise<DailyMetrics[]>;
  upsertMetrics(drafts: MetricsDraft[]): Promise<void>;

  // Nutrition ----------------------------------------------------------------
  listNutrition(range: DateRange): Promise<NutritionLog[]>;
  createNutrition(draft: NutritionDraft): Promise<NutritionLog>;
  deleteNutrition(id: UUID): Promise<void>;
  /**
   * Estimates a meal from a photo and/or a description (Claude vision via the `meal` edge
   * function). Never throws for "AI unavailable": falls back to a rough local estimate with
   * `engine: 'rules'` and `confidence: 'low'`. Throws RepositoryError for auth/validation/network.
   */
  analyzeMeal(input: MealAnalysisInput): Promise<MealAnalysis>;

  // Morning briefing -----------------------------------------------------------
  /** The stored briefing of `date` (server-side, written by the `briefing` function), or null. */
  getBriefing(date: ISODate): Promise<Briefing | null>;
  /**
   * Generates (or returns today's cached) briefing: refreshes Garmin first when stale, then
   * Claude writes it. `refresh` forces a new one. Falls back to a local template
   * (`engine: 'rules'`) when the AI is unavailable, so it only throws for auth/network errors.
   */
  generateBriefing(date: ISODate, opts?: { refresh?: boolean }): Promise<Briefing>;

  // Social -------------------------------------------------------------------
  searchProfiles(query: string): Promise<PublicProfile[]>;
  listFriends(): Promise<Friend[]>;
  sendFriendRequest(username: string): Promise<void>;
  respondFriendRequest(friendshipId: UUID, accept: boolean): Promise<void>;
  removeFriend(friendshipId: UUID): Promise<void>;
  /** Friend's calendar, masked by their visibility setting. */
  getFriendWeek(friendId: UUID, range: DateRange): Promise<FriendWeekItem[]>;
  listJointSessions(range: DateRange): Promise<JointSession[]>;
  getJointSession(id: UUID): Promise<JointSession | null>;
  proposeJointSession(draft: JointSessionDraft): Promise<JointSession>;
  respondJointSession(id: UUID, accept: boolean): Promise<void>;
  cancelJointSession(id: UUID): Promise<void>;
  listFeed(limit?: number): Promise<FeedItem[]>;
  toggleKudos(feedItemId: UUID): Promise<void>;

  // Notifications ------------------------------------------------------------
  listNotifications(limit?: number): Promise<AppNotification[]>;
  markNotificationsRead(ids: UUID[] | 'all'): Promise<void>;
  registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void>;

  // Proposals & coach --------------------------------------------------------
  listProposals(status?: ProposalStatus): Promise<PlanProposal[]>;
  getProposal(id: UUID): Promise<PlanProposal | null>;
  createProposal(draft: ProposalDraft): Promise<PlanProposal>;
  setProposalStatus(id: UUID, status: ProposalStatus): Promise<void>;
  /** AI coach (edge function). Falls back to the rules engine when AI is unavailable. */
  requestCoach(request: CoachRequest): Promise<CoachResponse>;

  // Integrations ---------------------------------------------------------------
  listIntegrations(): Promise<IntegrationStatus[]>;
  /** Stores the user's Garmin Personal API key (encrypted server-side) and runs a first sync. */
  connectGarmin(apiKey: string, expiresAt: string | null): Promise<IntegrationStatus>;
  disconnectGarmin(): Promise<void>;
  /** Pulls recent Garmin metrics + activities (Personal API) into daily_metrics / workouts. */
  syncGarmin(): Promise<SyncResult>;

  // Personal tokens (Claude connector, calendar feed) --------------------------
  listTokens(): Promise<PersonalToken[]>;
  createToken(scope: TokenScope, label: string): Promise<CreatedToken>;
  revokeToken(id: UUID): Promise<void>;

  // Realtime -----------------------------------------------------------------
  /** Calls `onChange` when data that affects the user changes remotely. Returns unsubscribe. */
  subscribe(onChange: (topic: ChangeTopic) => void): () => void;
}
