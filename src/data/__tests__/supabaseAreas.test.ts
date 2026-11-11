/// <reference types="jest" />
import type { WeekPlanDraft } from '@/domain/types';

import type { Repository } from '../repository';
import { createSupabaseRepository } from '../supabase/SupabaseRepository';
import { subscribeRealtime } from '../supabase/realtime';
import { createCtx } from '../supabase/base';
import { chainArgs, fakeClient, type FakeCall, type FakeResponses } from './supabaseFake';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../demo/rulesCoach', () => ({ runRulesCoach: jest.fn() }));

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const NOW = new Date('2026-10-25T10:00:00.000Z');
const ISO = NOW.toISOString();

function repoWith(responses: FakeResponses): { repo: Repository; calls: FakeCall[] } {
  const { client, calls } = fakeClient(responses);
  return { repo: createSupabaseRepository({ client, now: () => NOW }), calls };
}

const PROFILE_ROW = {
  id: 'me',
  username: 'diego',
  display_name: 'Diego',
  avatar_url: null,
  sports: ['swim', 'bike', 'run'],
  level: 'intermediate',
  thresholds: {},
  availability: {},
  visibility: 'full',
  notification_prefs: {},
  timezone: 'Europe/Madrid',
  coach_notes: null,
  onboarded_at: null,
  created_at: ISO,
};

describe('Supabase profile', () => {
  it('reads and patches my profile', async () => {
    const { repo, calls } = repoWith({ profiles: { data: PROFILE_ROW, error: null } });
    expect((await repo.getMyProfile())?.availability.weeklyHoursTarget).toBe(8);
    await repo.upsertMyProfile({ displayName: ' Diego M ', onboardedAt: ISO });
    expect(chainArgs(calls[1], 'update')?.[0]).toEqual({ display_name: 'Diego M', onboarded_at: ISO });
    await expect(repo.upsertMyProfile({ username: 'No Vale' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('checks usernames with the RPC', async () => {
    const { repo, calls } = repoWith({ 'rpc:is_username_available': { data: true, error: null } });
    expect(await repo.isUsernameAvailable('@Diego_T')).toBe(true);
    expect(calls[0]?.args[0]).toEqual({ p_username: 'diego_t' });
    expect(await repo.isUsernameAvailable('x')).toBe(false);
  });
});

describe('Supabase planning & wellness', () => {
  it('queries races, life events (overlap) and busy blocks', async () => {
    const { repo, calls } = repoWith({ races: { data: [], error: null }, life_events: { data: [], error: null }, busy_blocks: { data: [], error: null } });
    await repo.listRaces();
    await repo.listLifeEvents({ from: '2026-10-26', to: '2026-11-01' });
    await repo.listBusyBlocks({ from: '2026-10-26', to: '2026-11-01' });
    expect(chainArgs(calls[1], 'lte')).toEqual(['start_date', '2026-11-01']);
    expect(chainArgs(calls[1], 'gte')).toEqual(['end_date', '2026-10-26']);
    expect(chainArgs(calls[2], 'lt')?.[0]).toBe('starts_at');
    expect(chainArgs(calls[2], 'gt')?.[0]).toBe('ends_at');
  });

  it('replaces busy blocks of a source (delete + insert)', async () => {
    const { repo, calls } = repoWith({ busy_blocks: { data: [], error: null } });
    await repo.replaceBusyBlocks({ from: '2026-10-26', to: '2026-11-01' }, 'device_calendar', [
      { start: '2026-10-27T08:00:00.000Z', end: '2026-10-27T13:00:00.000Z', source: 'device_calendar', title: 'Clase' },
    ]);
    expect(calls[0]?.chain.map(([m]) => m)).toEqual(expect.arrayContaining(['delete', 'eq', 'lt', 'gt']));
    expect(chainArgs(calls[1], 'insert')?.[0]).toEqual([
      expect.objectContaining({ user_id: 'me', source: 'device_calendar', starts_at: '2026-10-27T08:00:00.000Z' }),
    ]);
    await expect(
      repo.createBusyBlock({ start: '2026-10-27T13:00:00.000Z', end: '2026-10-27T08:00:00.000Z', source: 'manual' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('upserts check-ins and metrics on their natural keys', async () => {
    const { repo, calls } = repoWith({
      daily_checkins: { data: { user_id: 'me', date: '2026-10-25', sleep_quality: 4, sleep_hours: '7.5', fatigue: 2, soreness: 1, stress: 2, motivation: 5, notes: null }, error: null },
      daily_metrics: { data: null, error: null },
    });
    const checkin = await repo.upsertCheckin({ date: '2026-10-25', sleepQuality: 4, sleepHours: 7.5, fatigue: 2, soreness: 1, stress: 2, motivation: 5, notes: null });
    expect(checkin.sleepHours).toBe(7.5);
    expect(chainArgs(calls[0], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,date' });
    await repo.upsertMetrics([{ date: '2026-10-25', source: 'healthkit', hrvMs: 60, restingHr: 50, sleepHours: null, sleepScore: null, bodyBattery: null, trainingReadiness: null, vo2max: null, steps: 9000.4, stressAvg: null, trainingStatus: null }]);
    expect(chainArgs(calls[1], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,date,source' });
    await repo.upsertMetrics([]);
    expect(calls).toHaveLength(2);
  });

  it('creates nutrition logs and rejects empty descriptions', async () => {
    const { repo } = repoWith({ nutrition_logs: { data: { id: 'n', user_id: 'me', date: '2026-10-25', meal: 'lunch', description: 'Arroz', kcal: 700, carbs_g: 90, protein_g: 40, fat_g: 15, created_at: ISO }, error: null } });
    expect((await repo.createNutrition({ date: '2026-10-25', meal: 'lunch', description: 'Arroz', kcal: 700 })).carbsG).toBe(90);
    await expect(repo.createNutrition({ date: '2026-10-25', meal: 'lunch', description: '  ' })).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('Supabase inbox & social RPCs', () => {
  it('marks notifications read (null = all) and registers push tokens', async () => {
    const { repo, calls } = repoWith({});
    await repo.markNotificationsRead('all');
    await repo.markNotificationsRead(['a']);
    await repo.markNotificationsRead([]);
    await repo.registerPushToken('deadbeef02', 'ios');
    expect(calls.map((c) => [c.target, c.args[0]])).toEqual([
      ['rpc:mark_notifications_read', { p_ids: null }],
      ['rpc:mark_notifications_read', { p_ids: ['a'] }],
      ['rpc:register_push_token', { p_token: 'deadbeef02', p_platform: 'ios' }],
    ]);
  });

  it('filters proposals by status and stores new ones', async () => {
    const row = { id: 'p', user_id: 'me', kind: 'chat', source: 'rules', week_start: '2026-10-26', summary: 's', changes: [], status: 'pending', model: null, created_at: ISO };
    const { repo, calls } = repoWith({ plan_proposals: { data: [row], error: null } });
    await repo.listProposals('pending');
    expect(calls[0]?.chain).toEqual(expect.arrayContaining([['eq', ['status', 'pending']]]));
    const single = repoWith({ plan_proposals: { data: row, error: null } });
    expect((await single.repo.createProposal({ kind: 'chat', source: 'rules', weekStart: '2026-10-26', summary: 's', changes: [] })).id).toBe('p');
  });

  it('calls the social RPCs with the documented parameter names', async () => {
    const { repo, calls } = repoWith({ 'rpc:list_friends': { data: [], error: null }, 'rpc:list_feed': { data: [], error: null } });
    await repo.sendFriendRequest('@Alex');
    await repo.respondFriendRequest('f1', true);
    await repo.listFriends();
    await repo.respondJointSession('j1', false);
    await repo.cancelJointSession('j1');
    await repo.listFeed(10);
    await repo.toggleKudos('e1');
    expect(calls.map((c) => [c.target, c.args[0]])).toEqual([
      ['rpc:send_friend_request', { p_username: 'alex' }],
      ['rpc:respond_friend_request', { p_friendship_id: 'f1', p_accept: true }],
      ['rpc:list_friends', undefined],
      ['rpc:respond_joint_session', { p_session_id: 'j1', p_accept: false }],
      ['rpc:cancel_joint_session', { p_session_id: 'j1' }],
      ['rpc:list_feed', { p_limit: 10 }],
      ['rpc:toggle_kudos', { p_event_id: 'e1' }],
    ]);
  });
});

describe('Supabase season plan (week_plans)', () => {
  const ROW = { user_id: 'me', week_start: '2026-11-02', kind: 'recovery', target_minutes: null, note: 'Exámenes', source: 'manual', created_at: ISO, updated_at: ISO };

  it('lists a range in week order, upserts on (user_id, week_start) and deletes one week', async () => {
    const { repo, calls } = repoWith({ week_plans: { data: [ROW], error: null } });
    await expect(repo.listWeekPlans({ from: '2026-10-19', to: '2027-01-04' })).resolves.toEqual([
      { weekStart: '2026-11-02', kind: 'recovery', targetMinutes: null, note: 'Exámenes', source: 'manual', updatedAt: ISO },
    ]);
    const list = calls[calls.length - 1];
    expect(chainArgs(list, 'gte')).toEqual(['week_start', '2026-10-19']);
    expect(chainArgs(list, 'lte')).toEqual(['week_start', '2027-01-04']);
    expect(chainArgs(list, 'order')).toEqual(['week_start', { ascending: true }]);

    await repo.saveWeekPlans([{ weekStart: '2026-11-02', kind: 'recovery', targetMinutes: 329.6, note: ' Exámenes ' }]);
    const upsert = calls[calls.length - 1];
    expect(chainArgs(upsert, 'upsert')).toEqual([
      [{ user_id: 'me', week_start: '2026-11-02', kind: 'recovery', target_minutes: 330, note: 'Exámenes', source: 'manual' }],
      { onConflict: 'user_id,week_start' },
    ]);

    await repo.deleteWeekPlan('2026-11-02');
    const removal = calls[calls.length - 1];
    expect(chainArgs(removal, 'delete')).toEqual([]);
    expect(removal?.chain.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([
      ['user_id', 'me'],
      ['week_start', '2026-11-02'],
    ]);
  });

  it.each([
    ['not a Monday', { weekStart: '2026-11-03', kind: 'load' }, 'lunes'],
    ['a past week', { weekStart: '2026-10-12', kind: 'load' }, 'desde esta'],
    ['beyond a year', { weekStart: '2027-10-25', kind: 'load' }, 'desde esta'],
    ['an unknown kind', { weekStart: '2026-11-02', kind: 'taper' }, 'carga, más volumen'],
    ['too many minutes', { weekStart: '2026-11-02', kind: 'push', targetMinutes: 3001 }, '50 horas'],
    ['a long note', { weekStart: '2026-11-02', kind: 'push', note: 'x'.repeat(301) }, '300 caracteres'],
  ])('rejects %s before calling the server', async (_label, draft, message) => {
    const { repo, calls } = repoWith({});
    await expect(repo.saveWeekPlans([draft as WeekPlanDraft])).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining(message) });
    expect(calls.some((c) => c.target === 'week_plans')).toBe(false);
  });

  it.each(['42P01', 'PGRST205', '42703', 'PGRST204'])('a server without the v4 migration (%s) says so in Spanish', async (code) => {
    const { repo } = repoWith({ week_plans: { data: null, error: { code, message: 'relation "week_plans" does not exist' } } });
    await expect(repo.listWeekPlans({ from: '2026-10-19', to: '2026-12-28' })).rejects.toMatchObject({
      code: 'unavailable',
      message: 'El servidor aún no tiene el plan general: hay que actualizarlo.',
    });
  });
});

describe('Supabase realtime', () => {
  it('opens one channel with per-table filters and removes it on unsubscribe', async () => {
    const bindings: { table: string; filter: string }[] = [];
    const channel = {
      on: (_type: string, filter: { table: string; filter: string }, _cb: unknown) => {
        bindings.push({ table: filter.table, filter: filter.filter });
        return channel;
      },
      subscribe: () => channel,
    };
    const removeChannel = jest.fn(async () => 'ok');
    const { client } = fakeClient({});
    const ctx = createCtx(Object.assign(client, { channel: jest.fn(() => channel), removeChannel }));
    const unsubscribe = subscribeRealtime(ctx, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bindings.filter((b) => b.filter === 'user_id=eq.me').map((b) => b.table)).toEqual(
      expect.arrayContaining(['workouts', 'notifications', 'plan_proposals', 'coach_jobs', 'joint_session_participants', 'races', 'life_events', 'daily_metrics', 'week_plans']),
    );
    expect(bindings.filter((b) => b.table === 'friendships').map((b) => b.filter)).toEqual(['requester_id=eq.me', 'addressee_id=eq.me']);
    unsubscribe();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
