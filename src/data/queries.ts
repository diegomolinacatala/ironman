/**
 * TanStack Query hooks over the Repository. Screens use ONLY these hooks for
 * data (never the repository or Supabase directly), so caching and
 * invalidation stay consistent.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import type {
  BusyBlockDraft,
  CheckinDraft,
  CoachRequest,
  CompletedData,
  DateRange,
  ISODate,
  JointSessionDraft,
  LifeEventDraft,
  MealAnalysisInput,
  MetricsDraft,
  NutritionDraft,
  PlanChange,
  ProfilePatch,
  ProposalDraft,
  ProposalStatus,
  RaceDraft,
  TokenScope,
  UUID,
  WorkoutDraft,
  WorkoutPatch,
} from '@/domain/types';

import { useAuth, useRepository } from './context';
import type { ChangeTopic } from './repository';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const qk = {
  profile: ['profile'] as const,
  workouts: (r: DateRange) => ['workouts', r.from, r.to] as const,
  workout: (id: UUID) => ['workout', id] as const,
  races: ['races'] as const,
  lifeEvents: (r: DateRange) => ['life_events', r.from, r.to] as const,
  busyBlocks: (r: DateRange) => ['busy_blocks', r.from, r.to] as const,
  checkins: (r: DateRange) => ['checkins', r.from, r.to] as const,
  metrics: (r: DateRange) => ['metrics', r.from, r.to] as const,
  nutrition: (r: DateRange) => ['nutrition', r.from, r.to] as const,
  profileSearch: (q: string) => ['profile_search', q] as const,
  friends: ['friends'] as const,
  friendWeek: (friendId: UUID, r: DateRange) => ['friend_week', friendId, r.from, r.to] as const,
  jointSessions: (r: DateRange) => ['joint_sessions', r.from, r.to] as const,
  jointSession: (id: UUID) => ['joint_session', id] as const,
  feed: ['feed'] as const,
  notifications: ['notifications'] as const,
  proposals: (status?: ProposalStatus) => ['proposals', status ?? 'all'] as const,
  proposal: (id: UUID) => ['proposal', id] as const,
  tokens: ['tokens'] as const,
  integrations: ['integrations'] as const,
  briefing: (date: ISODate) => ['briefing', date] as const,
};

/** Root keys invalidated for each change topic. */
const TOPIC_KEYS: Record<ChangeTopic, readonly string[]> = {
  workouts: ['workouts', 'workout', 'friend_week'],
  races: ['races'],
  life_events: ['life_events'],
  busy_blocks: ['busy_blocks', 'friend_week'],
  checkins: ['checkins'],
  metrics: ['metrics'],
  nutrition: ['nutrition'],
  friends: ['friends', 'friend_week', 'profile_search', 'feed'],
  joint_sessions: ['joint_sessions', 'joint_session', 'workouts', 'workout', 'friend_week'],
  feed: ['feed'],
  notifications: ['notifications'],
  proposals: ['proposals', 'proposal'],
  profile: ['profile'],
  integrations: ['integrations'],
  briefings: ['briefing'],
};

function useInvalidate() {
  const client = useQueryClient();
  return (topics: readonly ChangeTopic[]) =>
    Promise.all(
      topics.flatMap((topic) =>
        TOPIC_KEYS[topic].map((root) => client.invalidateQueries({ queryKey: [root] as QueryKey })),
      ),
    );
}

/** Mutation helper that invalidates the given topics on success. */
function useRepoMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, topics: readonly ChangeTopic[]) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate(topics),
  });
}

function useSignedIn(): boolean {
  return Boolean(useAuth().session);
}

/** Subscribes to repository realtime changes and invalidates affected queries. */
export function useRealtimeInvalidation(): void {
  const repo = useRepository();
  const invalidate = useInvalidate();
  useEffect(() => repo.subscribe((topic) => void invalidate([topic])), [repo]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useProfile() {
  const repo = useRepository();
  return useQuery({ queryKey: qk.profile, queryFn: () => repo.getMyProfile(), enabled: useSignedIn() });
}

export function useUpdateProfile() {
  const repo = useRepository();
  return useRepoMutation((patch: ProfilePatch) => repo.upsertMyProfile(patch), ['profile']);
}

export function useUsernameAvailable(username: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['username_available', username],
    queryFn: () => repo.isUsernameAvailable(username),
    enabled: username.length >= 3,
  });
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export function useWorkouts(range: DateRange) {
  const repo = useRepository();
  return useQuery({ queryKey: qk.workouts(range), queryFn: () => repo.listWorkouts(range), enabled: useSignedIn() });
}

export function useWorkout(id: UUID | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.workout(id ?? ''),
    queryFn: () => repo.getWorkout(id as UUID),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useCreateWorkout() {
  const repo = useRepository();
  return useRepoMutation((draft: WorkoutDraft) => repo.createWorkout(draft), ['workouts']);
}

export function useUpdateWorkout() {
  const repo = useRepository();
  return useRepoMutation(({ id, patch }: { id: UUID; patch: WorkoutPatch }) => repo.updateWorkout(id, patch), [
    'workouts',
  ]);
}

export function useDeleteWorkout() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.deleteWorkout(id), ['workouts', 'joint_sessions']);
}

export function useCompleteWorkout() {
  const repo = useRepository();
  return useRepoMutation(
    ({ id, data }: { id: UUID; data: CompletedData }) => repo.completeWorkout(id, data),
    ['workouts', 'feed'],
  );
}

export function useSkipWorkout() {
  const repo = useRepository();
  return useRepoMutation(({ id, reason }: { id: UUID; reason?: string }) => repo.skipWorkout(id, reason), [
    'workouts',
  ]);
}

export function useResetWorkout() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.resetWorkout(id), ['workouts', 'feed']);
}

export function useApplyPlanChanges() {
  const repo = useRepository();
  return useRepoMutation(
    ({ changes, proposalId }: { changes: PlanChange[]; proposalId?: UUID }) =>
      repo.applyPlanChanges(changes, proposalId),
    ['workouts', 'proposals', 'joint_sessions'],
  );
}

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

export function useRaces() {
  const repo = useRepository();
  return useQuery({ queryKey: qk.races, queryFn: () => repo.listRaces(), enabled: useSignedIn() });
}

export function useCreateRace() {
  const repo = useRepository();
  return useRepoMutation((draft: RaceDraft) => repo.createRace(draft), ['races', 'feed']);
}

export function useUpdateRace() {
  const repo = useRepository();
  return useRepoMutation(({ id, patch }: { id: UUID; patch: Partial<RaceDraft> }) => repo.updateRace(id, patch), [
    'races',
  ]);
}

export function useDeleteRace() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.deleteRace(id), ['races']);
}

// ---------------------------------------------------------------------------
// Life events
// ---------------------------------------------------------------------------

export function useLifeEvents(range: DateRange) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.lifeEvents(range),
    queryFn: () => repo.listLifeEvents(range),
    enabled: useSignedIn(),
  });
}

export function useCreateLifeEvent() {
  const repo = useRepository();
  return useRepoMutation((draft: LifeEventDraft) => repo.createLifeEvent(draft), ['life_events']);
}

export function useUpdateLifeEvent() {
  const repo = useRepository();
  return useRepoMutation(
    ({ id, patch }: { id: UUID; patch: Partial<LifeEventDraft> }) => repo.updateLifeEvent(id, patch),
    ['life_events'],
  );
}

export function useDeleteLifeEvent() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.deleteLifeEvent(id), ['life_events']);
}

// ---------------------------------------------------------------------------
// Busy blocks
// ---------------------------------------------------------------------------

export function useBusyBlocks(range: DateRange) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.busyBlocks(range),
    queryFn: () => repo.listBusyBlocks(range),
    enabled: useSignedIn(),
  });
}

export function useReplaceBusyBlocks() {
  const repo = useRepository();
  return useRepoMutation(
    ({ range, source, blocks }: { range: DateRange; source: BusyBlockDraft['source']; blocks: BusyBlockDraft[] }) =>
      repo.replaceBusyBlocks(range, source, blocks),
    ['busy_blocks'],
  );
}

export function useCreateBusyBlock() {
  const repo = useRepository();
  return useRepoMutation((draft: BusyBlockDraft) => repo.createBusyBlock(draft), ['busy_blocks']);
}

export function useDeleteBusyBlock() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.deleteBusyBlock(id), ['busy_blocks']);
}

// ---------------------------------------------------------------------------
// Wellness
// ---------------------------------------------------------------------------

export function useCheckins(range: DateRange) {
  const repo = useRepository();
  return useQuery({ queryKey: qk.checkins(range), queryFn: () => repo.listCheckins(range), enabled: useSignedIn() });
}

export function useUpsertCheckin() {
  const repo = useRepository();
  return useRepoMutation((draft: CheckinDraft) => repo.upsertCheckin(draft), ['checkins']);
}

export function useMetrics(range: DateRange) {
  const repo = useRepository();
  return useQuery({ queryKey: qk.metrics(range), queryFn: () => repo.listMetrics(range), enabled: useSignedIn() });
}

export function useUpsertMetrics() {
  const repo = useRepository();
  return useRepoMutation((drafts: MetricsDraft[]) => repo.upsertMetrics(drafts), ['metrics']);
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export function useNutrition(range: DateRange) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.nutrition(range),
    queryFn: () => repo.listNutrition(range),
    enabled: useSignedIn(),
  });
}

export function useCreateNutrition() {
  const repo = useRepository();
  return useRepoMutation((draft: NutritionDraft) => repo.createNutrition(draft), ['nutrition']);
}

export function useDeleteNutrition() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.deleteNutrition(id), ['nutrition']);
}

/** Photo/description → estimated meal. Does not save anything: confirm, then `useCreateNutrition`. */
export function useAnalyzeMeal() {
  const repo = useRepository();
  return useMutation({ mutationFn: (input: MealAnalysisInput) => repo.analyzeMeal(input) });
}

// ---------------------------------------------------------------------------
// Morning briefing
// ---------------------------------------------------------------------------

/** Stored briefing of `date` (null until generated). */
export function useBriefing(date: ISODate) {
  const repo = useRepository();
  return useQuery({ queryKey: qk.briefing(date), queryFn: () => repo.getBriefing(date), enabled: useSignedIn() });
}

/** Generates the briefing (refreshing Garmin first) and puts it in the `useBriefing(date)` cache. */
export function useGenerateBriefing() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ date, refresh }: { date: ISODate; refresh?: boolean }) => repo.generateBriefing(date, { refresh }),
    onSuccess: (briefing) => {
      client.setQueryData(qk.briefing(briefing.date), briefing);
      void client.invalidateQueries({ queryKey: ['metrics'] });
      void client.invalidateQueries({ queryKey: ['workouts'] });
      void client.invalidateQueries({ queryKey: qk.integrations });
    },
  });
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export function useProfileSearch(query: string) {
  const repo = useRepository();
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.profileSearch(trimmed),
    queryFn: () => repo.searchProfiles(trimmed),
    enabled: useSignedIn() && trimmed.length >= 2,
  });
}

export function useFriends() {
  const repo = useRepository();
  return useQuery({ queryKey: qk.friends, queryFn: () => repo.listFriends(), enabled: useSignedIn() });
}

export function useSendFriendRequest() {
  const repo = useRepository();
  return useRepoMutation((username: string) => repo.sendFriendRequest(username), ['friends']);
}

export function useRespondFriendRequest() {
  const repo = useRepository();
  return useRepoMutation(
    ({ friendshipId, accept }: { friendshipId: UUID; accept: boolean }) =>
      repo.respondFriendRequest(friendshipId, accept),
    ['friends', 'notifications'],
  );
}

export function useRemoveFriend() {
  const repo = useRepository();
  return useRepoMutation((friendshipId: UUID) => repo.removeFriend(friendshipId), ['friends']);
}

export function useFriendWeek(friendId: UUID | undefined, range: DateRange) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.friendWeek(friendId ?? '', range),
    queryFn: () => repo.getFriendWeek(friendId as UUID, range),
    enabled: useSignedIn() && Boolean(friendId),
  });
}

export function useJointSessions(range: DateRange) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.jointSessions(range),
    queryFn: () => repo.listJointSessions(range),
    enabled: useSignedIn(),
  });
}

export function useJointSession(id: UUID | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.jointSession(id ?? ''),
    queryFn: () => repo.getJointSession(id as UUID),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useProposeJointSession() {
  const repo = useRepository();
  return useRepoMutation((draft: JointSessionDraft) => repo.proposeJointSession(draft), [
    'joint_sessions',
    'workouts',
  ]);
}

export function useRespondJointSession() {
  const repo = useRepository();
  return useRepoMutation(
    ({ id, accept }: { id: UUID; accept: boolean }) => repo.respondJointSession(id, accept),
    ['joint_sessions', 'workouts', 'notifications'],
  );
}

export function useCancelJointSession() {
  const repo = useRepository();
  return useRepoMutation((id: UUID) => repo.cancelJointSession(id), ['joint_sessions', 'workouts']);
}

export function useFeed(limit = 30) {
  const repo = useRepository();
  return useQuery({ queryKey: [...qk.feed, limit], queryFn: () => repo.listFeed(limit), enabled: useSignedIn() });
}

export function useToggleKudos() {
  const repo = useRepository();
  return useRepoMutation((feedItemId: UUID) => repo.toggleKudos(feedItemId), ['feed']);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotifications(limit = 50) {
  const repo = useRepository();
  return useQuery({
    queryKey: [...qk.notifications, limit],
    queryFn: () => repo.listNotifications(limit),
    enabled: useSignedIn(),
  });
}

export function useMarkNotificationsRead() {
  const repo = useRepository();
  return useRepoMutation((ids: UUID[] | 'all') => repo.markNotificationsRead(ids), ['notifications']);
}

// ---------------------------------------------------------------------------
// Proposals & coach
// ---------------------------------------------------------------------------

export function useProposals(status?: ProposalStatus) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.proposals(status),
    queryFn: () => repo.listProposals(status),
    enabled: useSignedIn(),
  });
}

export function useProposal(id: UUID | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.proposal(id ?? ''),
    queryFn: () => repo.getProposal(id as UUID),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useCreateProposal() {
  const repo = useRepository();
  return useRepoMutation((draft: ProposalDraft) => repo.createProposal(draft), ['proposals']);
}

export function useSetProposalStatus() {
  const repo = useRepository();
  return useRepoMutation(
    ({ id, status }: { id: UUID; status: ProposalStatus }) => repo.setProposalStatus(id, status),
    ['proposals'],
  );
}

/** Calls the AI coach; resulting proposal (if any) lands in the proposals cache. */
export function useCoach() {
  const repo = useRepository();
  // The coach may also save preferences (profile.coachNotes) and log an imprevisto.
  return useRepoMutation((request: CoachRequest) => repo.requestCoach(request), ['proposals', 'profile', 'life_events']);
}

// ---------------------------------------------------------------------------
// Integrations (Garmin Personal API)
// ---------------------------------------------------------------------------

export function useIntegrations() {
  const repo = useRepository();
  return useQuery({ queryKey: qk.integrations, queryFn: () => repo.listIntegrations(), enabled: useSignedIn() });
}

export function useConnectGarmin() {
  const repo = useRepository();
  return useRepoMutation(
    ({ apiKey, expiresAt }: { apiKey: string; expiresAt: string | null }) => repo.connectGarmin(apiKey, expiresAt),
    ['integrations', 'metrics', 'workouts'],
  );
}

export function useDisconnectGarmin() {
  const repo = useRepository();
  return useRepoMutation(() => repo.disconnectGarmin(), ['integrations']);
}

export function useSyncGarmin() {
  const repo = useRepository();
  return useRepoMutation(() => repo.syncGarmin(), ['integrations', 'metrics', 'workouts', 'feed']);
}

// ---------------------------------------------------------------------------
// Personal tokens
// ---------------------------------------------------------------------------

export function useTokens() {
  const repo = useRepository();
  return useQuery({ queryKey: qk.tokens, queryFn: () => repo.listTokens(), enabled: useSignedIn() });
}

export function useCreateToken() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, label }: { scope: TokenScope; label: string }) => repo.createToken(scope, label),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });
}

export function useRevokeToken() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => repo.revokeToken(id),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });
}
