/**
 * In-memory test doubles for the store ports (used only by *.test.ts).
 * Mirrors the user scoping of the real adapters: every method filters by userId.
 */
import { StoreRejectedError } from '../planning/store.ts';
import type { ApplyChangesResult, MetricsUpsert, PlanningStore, ProposedJointSession, RaceWrite, ServerMetricsSource } from '../planning/store.ts';
import type {
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  FriendSummary,
  FriendWeekItem,
  JointSession,
  LifeEvent,
  NutritionLog,
  PlanChange,
  Profile,
  ProposalDraft,
  Race,
  UUID,
  WeekPlan,
  Workout,
} from '../types.ts';

export const USER: UUID = '11111111-1111-4111-8111-111111111111';
export const FRIEND: UUID = '22222222-2222-4222-8222-222222222222';
export const OTHER_USER: UUID = '33333333-3333-4333-8333-333333333333';

let counter = 0;
export function uuid(): UUID {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: USER,
    username: 'diego',
    displayName: 'Diego',
    sports: ['swim', 'bike', 'run'],
    level: 'intermediate',
    thresholds: { ftpW: 250, lthr: 170, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 100 },
    availability: {
      weeklyHoursTarget: 9,
      restDay: 0,
      longSessionDays: [5, 6],
      windows: [{ weekday: 1, start: '07:00', end: '09:00' }],
      poolDays: [1, 3],
    },
    visibility: 'full',
    notificationPrefs: { social: true },
    timezone: 'Europe/Madrid',
    coachNotes: null,
    ...overrides,
  };
}

export function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: uuid(),
    userId: USER,
    date: '2026-10-27',
    startTime: '07:00',
    sport: 'run',
    title: 'Rodaje Z2',
    description: null,
    durationMin: 50,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'manual',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

export interface FakeState {
  profiles: Profile[];
  workouts: Workout[];
  races: (Race & { userId: UUID })[];
  events: (LifeEvent & { userId: UUID })[];
  busy: (BusyBlock & { userId: UUID })[];
  checkins: (DailyCheckin & { userId: UUID })[];
  metrics: (DailyMetrics & { userId: UUID })[];
  nutrition: (NutritionLog & { userId: UUID })[];
  joint: JointSession[];
  friends: Map<UUID, FriendSummary[]>;
  friendWeeks: Map<UUID, FriendWeekItem[]>;
  proposals: (ProposalDraft & { id: UUID; userId: UUID })[];
  applied: { userId: UUID; changes: PlanChange[]; proposalId: UUID }[];
  metricUpserts: { userId: UUID; source: ServerMetricsSource; rows: MetricsUpsert[] }[];
  weekPlans: (WeekPlan & { userId: UUID })[];
}

export function emptyState(): FakeState {
  return {
    profiles: [profile()],
    workouts: [],
    races: [],
    events: [],
    busy: [],
    checkins: [],
    metrics: [],
    nutrition: [],
    joint: [],
    friends: new Map(),
    friendWeeks: new Map(),
    proposals: [],
    applied: [],
    metricUpserts: [],
    weekPlans: [],
  };
}

const inRange = (d: string, from: string, to: string): boolean => d >= from && d <= to;

/** Week-plan methods of the fake store (upsert by user + Monday, like the table's primary key). */
function fakeWeekPlans(state: FakeState): Pick<PlanningStore, 'listWeekPlans' | 'saveWeekPlans' | 'deleteWeekPlans'> {
  const strip = ({ userId: _u, ...plan }: WeekPlan & { userId: UUID }): WeekPlan => plan;
  return {
    listWeekPlans: async (userId, from, to) =>
      state.weekPlans
        .filter((p) => p.userId === userId && inRange(p.weekStart, from, to))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map(strip),
    saveWeekPlans: async (userId, drafts) => {
      const saved = drafts.map((d) => ({
        userId,
        weekStart: d.weekStart,
        kind: d.kind,
        targetMinutes: d.targetMinutes ?? null,
        note: d.note ?? null,
        source: d.source ?? 'manual',
        updatedAt: NOW.toISOString(),
      }));
      const keys = new Set(saved.map((p) => p.weekStart));
      state.weekPlans = [...state.weekPlans.filter((p) => p.userId !== userId || !keys.has(p.weekStart)), ...saved];
      return saved.map(strip);
    },
    deleteWeekPlans: async (userId, weekStarts) => {
      const before = state.weekPlans.length;
      state.weekPlans = state.weekPlans.filter((p) => p.userId !== userId || !weekStarts.includes(p.weekStart));
      return before - state.weekPlans.length;
    },
  };
}

export function fakeStore(state: FakeState, applyResult?: ApplyChangesResult): PlanningStore {
  const findByExternalId: PlanningStore['findByExternalId'] = async (userId, externalId, rawId) =>
    state.workouts.find((w) => w.userId === userId && (w.externalId === externalId || w.completed?.externalId === rawId)) ?? null;
  return {
    getProfile: async (userId) => state.profiles.find((p) => p.id === userId) ?? null,
    listWorkouts: async (userId, from, to) => state.workouts.filter((w) => w.userId === userId && inRange(w.date, from, to)),
    listRaces: async (userId) => state.races.filter((r) => r.userId === userId),
    listLifeEvents: async (userId, from, to) => state.events.filter((e) => e.userId === userId && e.startDate <= to && e.endDate >= from),
    listBusyBlocks: async (userId, fromIso, toIso) => state.busy.filter((b) => b.userId === userId && b.start >= fromIso && b.start < toIso),
    listCheckins: async (userId, from, to) => state.checkins.filter((c) => c.userId === userId && inRange(c.date, from, to)),
    listMetrics: async (userId, from, to) => state.metrics.filter((m) => m.userId === userId && inRange(m.date, from, to)),
    listNutrition: async (userId, from, to) => state.nutrition.filter((n) => n.userId === userId && inRange(n.date, from, to)),
    listJointSessions: async (userId, from, to) =>
      state.joint.filter((s) => inRange(s.date, from, to) && (s.organizerId === userId || s.participants.some((p) => p.userId === userId))),
    listFriends: async (userId) => state.friends.get(userId) ?? [],
    getFriendWeek: async (_viewer, friendId, from, to) => (state.friendWeeks.get(friendId) ?? []).filter((i) => inRange(i.date, from, to)),
    insertProposal: async (userId, draft) => {
      const id = uuid();
      state.proposals.push({ ...draft, id, userId });
      return id;
    },
    applyPlanChanges: async (userId, changes, proposalId) => {
      state.applied.push({ userId, changes, proposalId });
      return applyResult ?? { applied: changes.length, failed: [] };
    },
    insertLifeEvent: async (userId, e) => {
      const created = { ...e, id: uuid(), userId };
      state.events.push(created);
      return created;
    },
    upsertMetrics: async (userId, source, rows) => {
      state.metricUpserts.push({ userId, source, rows });
      return rows.length;
    },
    completeWorkout: async (userId, workoutId, completed) => {
      const idx = state.workouts.findIndex((w) => w.id === workoutId && w.userId === userId && w.status === 'planned');
      if (idx === -1) return false;
      state.workouts[idx] = { ...state.workouts[idx], status: 'completed', completed };
      return true;
    },
    findByExternalId,
    insertCompletedWorkout: async (userId, row) => {
      if (row.externalId && (await findByExternalId(userId, row.externalId, row.externalId.replace(/^garmin:/, '')))) return null;
      const created = workout({ ...row, id: uuid(), userId, status: 'completed', description: null, tss: null, steps: [], isKey: false, jointSessionId: null });
      state.workouts.push(created);
      return created;
    },
    insertRace: async (userId, race) => {
      const created = { id: uuid(), userId, location: null, goal: null, notes: null, ...race } as Race & { userId: UUID };
      state.races.push(created);
      return created;
    },
    proposeJointSession: async (userId, draft, inviteeIds) => {
      // Mirrors private.propose_joint_session_as: same checks and Spanish messages.
      const invitees = [...new Set(inviteeIds)];
      if (invitees.length === 0 && !draft.isOpen) throw new StoreRejectedError('validation', 'Invita al menos a un amigo');
      if (invitees.length > 10) throw new StoreRejectedError('validation', 'Puedes invitar como máximo a 10 personas');
      if (invitees.includes(userId)) throw new StoreRejectedError('validation', 'No puedes invitarte a ti mismo');
      const friends = state.friends.get(userId) ?? [];
      if (invitees.some((id) => !friends.some((f) => f.friendId === id))) throw new StoreRejectedError('forbidden', 'Solo puedes invitar a tus amigos');
      const id = uuid();
      const linked = workout({
        userId,
        date: draft.date,
        startTime: draft.startTime,
        sport: draft.sport,
        title: draft.title,
        durationMin: draft.durationMin,
        intensity: draft.intensity,
        source: 'joint',
        jointSessionId: id,
      });
      state.workouts.push(linked);
      const me = state.profiles.find((p) => p.id === userId);
      const created: ProposedJointSession = {
        id,
        organizerId: userId,
        ...draft,
        status: 'proposed',
        participants: [
          { userId, displayName: me?.displayName ?? 'Yo', status: 'accepted', workoutId: linked.id },
          ...invitees.map((fid) => ({ userId: fid, displayName: friends.find((f) => f.friendId === fid)?.displayName ?? 'Amigo', status: 'invited' as const, workoutId: null })),
        ],
        createdAt: NOW.toISOString(),
      };
      state.joint.push(created);
      return created;
    },
    updateRace: async (userId, raceId, patch: RaceWrite) => {
      const idx = state.races.findIndex((r) => r.id === raceId && r.userId === userId);
      if (idx === -1) return null;
      state.races[idx] = { ...state.races[idx], ...patch } as Race & { userId: UUID };
      return state.races[idx];
    },
    ...fakeWeekPlans(state),
  };
}

/** Fixed clock: Saturday 2026-10-24 10:00 UTC (12:00 in Madrid, CEST). */
export const NOW = new Date('2026-10-24T10:00:00.000Z');
export const fixedNow = (): Date => NOW;
