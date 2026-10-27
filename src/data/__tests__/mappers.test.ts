/// <reference types="jest" />
import type {
  AppNotification,
  BusyBlock,
  DailyMetrics,
  LifeEvent,
  NutritionLog,
  PlanProposal,
  Profile,
  Race,
  Workout,
} from '@/domain/types';

import {
  busyBlockToRow,
  checkinDraftToRow,
  lifeEventDraftToInsert,
  lifeEventToRow,
  metricsDraftToRow,
  notificationToRow,
  nutritionToRow,
  profilePatchToRow,
  profileToRow,
  proposalToRow,
  raceToRow,
  rowToBusyBlock,
  rowToCheckin,
  rowToLifeEvent,
  rowToMetrics,
  rowToNotification,
  rowToNutrition,
  rowToProfile,
  rowToProposal,
  rowToRace,
  rowToWorkout,
  workoutDraftToInsert,
  workoutPatchToUpdate,
  workoutToRow,
} from '../supabase/mappers';
import {
  parseCreatedToken,
  parseSyncResult,
  rowToFeedItem,
  rowToFriend,
  rowToFriendWeekItem,
  rowToIntegration,
  rowToToken,
  tokenUrl,
} from '../supabase/mappersRpc';
import { DEFAULT_AVAILABILITY, parseAvailability, parseJointSession, parsePlanChanges, parseSteps } from '../supabase/parsers';
import type { ProposalRow, WorkoutRow } from '../supabase/rows';

const NOW = '2026-10-25T10:00:00.000Z';
const ME = '0d1e6000-0000-4000-8000-000000000001';

const profile: Profile = {
  id: ME,
  username: 'diego',
  displayName: 'Diego',
  avatarUrl: null,
  sports: ['swim', 'bike', 'run'],
  level: 'intermediate',
  thresholds: { ftpW: 245, lthr: 172 },
  availability: {
    weeklyHoursTarget: 10,
    restDay: 0,
    longSessionDays: [5, 6],
    windows: [{ weekday: 1, start: '07:00', end: '08:30' }],
    poolDays: [1, 3],
  },
  visibility: 'summary',
  notificationPrefs: {
    workoutReminders: true,
    reminderMinutesBefore: 45,
    morningSummary: false,
    morningTime: '07:00',
    eveningCheckin: true,
    eveningTime: '21:00',
    weeklyPlanReminder: true,
    social: false,
  },
  timezone: 'Europe/Madrid',
  coachNotes: 'Notas',
  onboardedAt: NOW,
  aiConsentAt: null,
  createdAt: NOW,
};

const workout: Workout = {
  id: 'w1',
  userId: ME,
  date: '2026-10-27',
  startTime: '19:30',
  sport: 'run',
  title: 'Rodaje',
  description: 'Suave',
  durationMin: 45,
  distanceM: 8000,
  intensity: 'endurance',
  tss: 48.5,
  steps: [{ kind: 'work', durationMin: 8, intensity: 'tempo', repeat: 3 }],
  status: 'completed',
  completed: { durationMin: 47, rpe: 5, source: 'garmin', completedAt: NOW },
  source: 'rules',
  isKey: true,
  jointSessionId: 'j1',
  externalId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('table mappers round-trip (domain → row → domain)', () => {
  it('profile', () => {
    expect(rowToProfile(profileToRow(profile))).toEqual(profile);
  });

  it('workout', () => {
    expect(rowToWorkout(workoutToRow(workout))).toEqual(workout);
  });

  it('race', () => {
    const race: Race = {
      id: 'r1',
      userId: ME,
      name: 'Media',
      date: '2027-04-11',
      distance: 'half',
      priority: 'A',
      location: 'Valencia',
      goal: 'sub 5h',
      notes: null,
      createdAt: NOW,
    };
    expect(rowToRace(raceToRow(race))).toEqual(race);
  });

  it('life event', () => {
    const event: LifeEvent = {
      id: 'e1',
      userId: ME,
      kind: 'injury',
      title: 'Rodilla',
      startDate: '2026-10-20',
      endDate: '2026-10-23',
      startTime: null,
      durationMin: null,
      severity: 3,
      bodyArea: 'knee',
      notes: 'Molestia',
      createdAt: NOW,
    };
    expect(rowToLifeEvent(lifeEventToRow(event))).toEqual(event);
  });

  it('busy block', () => {
    const block: BusyBlock = {
      id: 'b1',
      userId: ME,
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T13:00:00.000Z',
      source: 'device_calendar',
      title: 'Clase',
      externalId: 'ek:1',
    };
    expect(rowToBusyBlock(busyBlockToRow(block))).toEqual(block);
  });

  it('check-in', () => {
    const draft = { date: '2026-10-25', sleepQuality: 4, sleepHours: 7.5, fatigue: 2, soreness: 1, stress: 3, motivation: 5, notes: null } as const;
    expect(rowToCheckin(checkinDraftToRow(draft, ME))).toEqual({ ...draft, userId: ME });
  });

  it('metrics', () => {
    const metrics: DailyMetrics = {
      userId: ME,
      date: '2026-10-25',
      source: 'garmin',
      hrvMs: 66.5,
      restingHr: 49,
      sleepHours: 7.25,
      sleepScore: 80,
      bodyBattery: 70,
      trainingReadiness: 65,
      vo2max: 54,
      steps: 12000,
      stressAvg: 25,
      trainingStatus: 'Productivo',
      sleepDeepMin: 82,
      sleepLightMin: 250,
      sleepRemMin: 104,
      sleepAwakeMin: 18,
      sleepStart: '2026-10-24T21:40:00.000Z',
      sleepEnd: '2026-10-25T05:15:00.000Z',
    };
    const { userId, ...draft } = metrics;
    const row = metricsDraftToRow(draft, userId);
    expect(row).toMatchObject({ sleep_deep_min: 82, sleep_rem_min: 104, sleep_start: '2026-10-24T21:40:00.000Z' });
    expect(rowToMetrics(row)).toEqual(metrics);
  });

  it('metrics without sleep detail (HealthKit) leave the v2 columns untouched', () => {
    const draft = {
      date: '2026-10-25',
      source: 'healthkit',
      hrvMs: 60,
      restingHr: 50,
      sleepHours: 7,
      sleepScore: null,
      bodyBattery: null,
      trainingReadiness: null,
      vo2max: null,
      steps: 9000,
      stressAvg: null,
      trainingStatus: null,
    } as const;
    const row = metricsDraftToRow(draft, ME);
    expect(Object.keys(row).some((k) => k.startsWith('sleep_') && k !== 'sleep_hours' && k !== 'sleep_score')).toBe(false);
    expect(rowToMetrics(row)).toMatchObject({ sleepDeepMin: null, sleepStart: null, sleepEnd: null });
    expect(metricsDraftToRow({ ...draft, sleepDeepMin: 2000.4, sleepAwakeMin: -3, sleepRemMin: null }, ME)).toMatchObject({
      sleep_deep_min: 1440,
      sleep_awake_min: 0,
      sleep_rem_min: null,
    });
  });

  it('nutrition', () => {
    const log: NutritionLog = {
      id: 'n1',
      userId: ME,
      date: '2026-10-25',
      meal: 'breakfast',
      description: 'Avena',
      kcal: 500,
      carbsG: 80,
      proteinG: 20,
      fatG: 10,
      createdAt: NOW,
    };
    expect(rowToNutrition(nutritionToRow(log))).toEqual(log);
  });

  it('notification', () => {
    const n: AppNotification = {
      id: 'x',
      userId: ME,
      type: 'joint_invite',
      title: 'Álex te invita',
      body: 'jue',
      data: { url: '/joint/1' },
      readAt: null,
      createdAt: NOW,
    };
    expect(rowToNotification(notificationToRow(n))).toEqual(n);
  });

  it('proposal (changes jsonb keeps camelCase PlanChange)', () => {
    const p: PlanProposal = {
      id: 'p1',
      userId: ME,
      kind: 'replan',
      source: 'claude',
      weekStart: '2026-10-26',
      summary: 'Ajustes',
      changes: [
        { op: 'add', workout: { date: '2026-10-28', sport: 'swim', title: 'Nado', durationMin: 40, intensity: 'endurance', startTime: '07:00' }, reason: 'r1' },
        { op: 'update', workoutId: 'w1', patch: { intensity: 'recovery', durationMin: 30 }, reason: 'r2' },
        { op: 'move', workoutId: 'w2', toDate: '2026-10-30', toStartTime: null, reason: 'r3' },
        { op: 'delete', workoutId: 'w3', reason: 'r4' },
      ],
      status: 'pending',
      model: 'claude-opus-5-5',
      createdAt: NOW,
    };
    expect(rowToProposal(proposalToRow(p))).toEqual(p);
  });
});

describe('row narrowing', () => {
  it('trims Postgres time seconds and parses numeric strings', () => {
    const row = { ...workoutToRow(workout), start_time: '07:05:00', tss: '55.0', steps: null, completed: null } as WorkoutRow;
    const mapped = rowToWorkout(row);
    expect(mapped.startTime).toBe('07:05');
    expect(mapped.tss).toBe(55);
    expect(mapped.steps).toEqual([]);
    expect(mapped.completed).toBeNull();
  });

  it('falls back on unknown enum values', () => {
    const mapped = rowToWorkout({ ...workoutToRow(workout), sport: 'crossfit', intensity: 'max', status: '??' } as WorkoutRow);
    expect(mapped.sport).toBe('other');
    expect(mapped.intensity).toBe('endurance');
    expect(mapped.status).toBe('planned');
  });

  it('defaults availability and drops invalid windows/steps', () => {
    expect(parseAvailability(null)).toEqual(DEFAULT_AVAILABILITY);
    const parsed = parseAvailability({ weeklyHoursTarget: '9', restDay: null, windows: [{ weekday: 9, start: '07:00', end: '08:00' }, { weekday: 2, start: '07:00:00', end: '08:00' }] });
    expect(parsed.weeklyHoursTarget).toBe(9);
    expect(parsed.restDay).toBeNull();
    expect(parsed.windows).toEqual([{ weekday: 2, start: '07:00', end: '08:00' }]);
    expect(parseSteps([{ kind: 'nope' }, { kind: 'warmup', durationMin: 10 }])).toEqual([{ kind: 'warmup', durationMin: 10 }]);
  });

  it('drops malformed plan changes', () => {
    const changes = parsePlanChanges([{ op: 'add', workout: { date: '2026-10-28' } }, { op: 'delete' }, { op: 'delete', workoutId: 'a', reason: 'x' }, 'junk']);
    expect(changes).toEqual([{ op: 'delete', workoutId: 'a', reason: 'x' }]);
  });

  it('keeps the workout source of proposed changes (apply_plan_changes stores it)', () => {
    const draft = { date: '2026-10-28', sport: 'run', title: 'Rodaje Z2', durationMin: 45, intensity: 'endurance' };
    const row: ProposalRow = {
      id: 'p1',
      user_id: ME,
      kind: 'replan',
      source: 'claude',
      week_start: '2026-10-26',
      summary: 's',
      changes: [
        { op: 'add', workout: { ...draft, source: 'claude' }, reason: 'r' },
        { op: 'add', workout: { ...draft, source: 'hacker' }, reason: 'r' },
        { op: 'update', workoutId: 'w1', patch: { durationMin: 30, source: 'ai_coach' }, reason: 'r' },
      ],
      status: 'pending',
      model: null,
      created_at: NOW,
    };
    const [add, invalid, update] = rowToProposal(row).changes;
    expect(add).toMatchObject({ op: 'add', workout: { source: 'claude' } });
    expect(invalid?.op === 'add' && 'source' in invalid.workout).toBe(false);
    expect(update).toMatchObject({ op: 'update', patch: { durationMin: 30, source: 'ai_coach' } });
  });
});

describe('insert/update builders', () => {
  it('workout draft insert rounds integer columns and defaults', () => {
    const row = workoutDraftToInsert({ date: '2026-10-27', sport: 'bike', title: ' Rodillo ', durationMin: 59.6, distanceM: 30000.4, intensity: 'tempo' }, ME);
    expect(row).toMatchObject({ user_id: ME, title: 'Rodillo', duration_min: 60, distance_m: 30000, start_time: null, steps: [], is_key: false, source: 'manual' });
  });

  it('workout patch only emits provided keys (null clears)', () => {
    expect(workoutPatchToUpdate({ status: 'skipped', completed: null, startTime: null })).toEqual({ status: 'skipped', completed: null, start_time: null });
  });

  it('profile patch lowercases username and omits undefined', () => {
    expect(profilePatchToRow({ username: 'Diego_T', onboardedAt: NOW })).toEqual({ username: 'diego_t', onboarded_at: NOW });
  });

  it('life event insert defaults end date to start date', () => {
    expect(lifeEventDraftToInsert({ kind: 'padel', title: 'Pádel', startDate: '2026-10-28', severity: 2 }, ME)).toMatchObject({ end_date: '2026-10-28', start_date: '2026-10-28' });
  });
});

describe('RPC mappers', () => {
  it('list_friends row → Friend (accepted is mutual)', () => {
    const friend = rowToFriend({
      friendship_id: 'f1',
      status: 'accepted',
      direction: 'incoming',
      created_at: NOW,
      friend_id: 'u2',
      username: 'alex',
      display_name: 'Álex',
      avatar_url: null,
      sports: ['swim', 'bike', 'run', 'padel'],
      visibility: 'summary',
    });
    expect(friend).toEqual({
      friendshipId: 'f1',
      status: 'accepted',
      direction: 'mutual',
      visibility: 'summary',
      createdAt: NOW,
      profile: { id: 'u2', username: 'alex', displayName: 'Álex', avatarUrl: null, sports: ['swim', 'bike', 'run'] },
    });
  });

  it('get_friend_week row → FriendWeekItem', () => {
    expect(
      rowToFriendWeekItem({ kind: 'busy', id: null, date: '2026-10-27', start_time: '09:00:00', end_time: '14:00:00', duration_min: 300, sport: null, intensity: null, title: null, status: null, joint_session_id: null }),
    ).toEqual({ kind: 'busy', id: null, date: '2026-10-27', startTime: '09:00', endTime: '14:00', durationMin: 300, sport: null, intensity: null, title: null, status: null, jointSessionId: null });
  });

  it('list_feed row → FeedItem', () => {
    const item = rowToFeedItem({ id: 'e', actor_id: 'u2', actor_username: 'alex', actor_display_name: 'Álex', actor_avatar_url: null, actor_sports: ['run'], type: 'workout_completed', payload: { sport: 'run' }, created_at: NOW, kudos_count: '2', has_kudoed: true });
    expect(item.kudosCount).toBe(2);
    expect(item.hasKudoed).toBe(true);
    expect(item.actor.displayName).toBe('Álex');
  });

  it('tokens, integrations and URLs', () => {
    expect(rowToToken({ id: 't', scope: 'ics', label: 'Cal', prefix: 'rb_abc', created_at: NOW, last_used_at: null, revoked_at: null }).scope).toBe('ics');
    expect(rowToIntegration({ provider: 'garmin_personal', state: 'expired', key_expires_at: '2026-11-01', last_sync_at: null, last_error: 'x' })).toEqual({ provider: 'garmin_personal', state: 'expired', expiresAt: '2026-11-01', lastSyncAt: null, lastError: 'x' });
    expect(tokenUrl('mcp', 'rb_s', 'https://p.supabase.co/functions/v1/')).toBe('https://p.supabase.co/functions/v1/mcp/u/rb_s');
    expect(tokenUrl('ics', 'rb_s', 'https://p.supabase.co/functions/v1')).toBe('https://p.supabase.co/functions/v1/ics/rb_s.ics');
    const created = parseCreatedToken({ id: 'i', secret: 'rb_0123456789abcdef', prefix: 'rb_0123456' }, { scope: 'mcp', label: 'Claude', now: NOW, functionsBaseUrl: 'https://x/functions/v1' });
    expect(created?.url).toBe('https://x/functions/v1/mcp/u/rb_0123456789abcdef');
    expect(created?.token).toMatchObject({ id: 'i', prefix: 'rb_0123456', label: 'Claude', revokedAt: null });
    expect(parseCreatedToken('nope', { scope: 'mcp', label: '', now: NOW, functionsBaseUrl: '' })).toBeNull();
  });

  it('sync result tolerates snake_case and builds a message', () => {
    const r = parseSyncResult({ metrics_days: 3, activitiesImported: 1 });
    expect(r).toMatchObject({ metricsDays: 3, activitiesImported: 1, workoutsCompleted: 0 });
    expect(r.message).toContain('3 días');
  });

  it('joint session jsonb accepts camelCase and snake_case', () => {
    const s = parseJointSession({
      id: 'j',
      organizer_id: 'u1',
      sport: 'bike',
      date: '2026-10-31',
      start_time: '08:30:00',
      durationMin: 180,
      intensity: 'endurance',
      title: 'Larga',
      status: 'confirmed',
      participants: [{ userId: 'u1', displayName: 'Diego', status: 'accepted', workoutId: 'w' }, { user_id: 'u2', display_name: 'Álex', status: 'invited' }],
      createdAt: NOW,
    });
    expect(s).toMatchObject({ organizerId: 'u1', startTime: '08:30', durationMin: 180, status: 'confirmed' });
    expect(s?.participants.map((p) => p.displayName)).toEqual(['Diego', 'Álex']);
  });
});
