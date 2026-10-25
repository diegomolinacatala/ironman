/// <reference types="jest" />
import type { Repository } from '../repository';
import { createSupabaseRepository } from '../supabase/SupabaseRepository';
import { workoutToRow } from '../supabase/mappers';
import { fakeClient, type FakeCall, type FakeResponses } from './supabaseFake';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../demo/rulesCoach', () => ({ runRulesCoach: jest.fn() }));

// Repository failures are logged as warnings by design; keep test output clean.
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const NOW = new Date('2026-10-25T10:00:00.000Z');
const ROW = workoutToRow({
  id: 'w1',
  userId: 'me',
  date: '2026-10-27',
  startTime: '07:00',
  sport: 'swim',
  title: 'Nado',
  description: null,
  durationMin: 45,
  distanceM: 2000,
  intensity: 'endurance',
  tss: null,
  steps: [],
  status: 'planned',
  completed: null,
  source: 'manual',
  isKey: false,
  jointSessionId: null,
  externalId: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

function repoWith(responses: FakeResponses): { repo: Repository; calls: FakeCall[] } {
  const { client, calls } = fakeClient(responses);
  return { repo: createSupabaseRepository({ client, now: () => NOW }), calls };
}

describe('SupabaseRepository (query building)', () => {
  it('lists my workouts in a date range', async () => {
    const { repo, calls } = repoWith({ workouts: { data: [{ ...ROW, start_time: '07:00:00' }], error: null } });
    const workouts = await repo.listWorkouts({ from: '2026-10-26', to: '2026-11-01' });
    expect(workouts[0]).toMatchObject({ id: 'w1', startTime: '07:00', sport: 'swim' });
    expect(calls[0]?.chain).toEqual(
      expect.arrayContaining([
        ['eq', ['user_id', 'me']],
        ['gte', ['date', '2026-10-26']],
        ['lte', ['date', '2026-11-01']],
      ]),
    );
  });

  it('inserts workouts with snake_case columns and validates first', async () => {
    const { repo, calls } = repoWith({ workouts: { data: ROW, error: null } });
    await repo.createWorkout({ date: '2026-10-27', sport: 'swim', title: 'Nado', durationMin: 45, intensity: 'endurance' });
    const insert = calls[0]?.chain.find(([m]) => m === 'insert');
    expect(insert?.[1][0]).toMatchObject({ user_id: 'me', duration_min: 45, sport: 'swim' });
    await expect(repo.createWorkout({ date: 'x', sport: 'swim', title: 'Nado', durationMin: 45, intensity: 'endurance' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('applies plan changes through the RPC and returns affected workouts', async () => {
    const { repo, calls } = repoWith({
      'rpc:apply_plan_changes': { data: { applied: 1, failed: [] }, error: null },
      workouts: { data: [ROW], error: null },
    });
    const changes = [{ op: 'move' as const, workoutId: 'w1', toDate: '2026-10-28', reason: 'r' }];
    const result = await repo.applyPlanChanges(changes, 'p1');
    expect(calls[0]).toMatchObject({ target: 'rpc:apply_plan_changes', args: [{ p_changes: changes, p_proposal_id: 'p1' }] });
    expect(result).toMatchObject({ applied: 1, failed: [] });
    expect(result.workouts.map((w) => w.id)).toEqual(['w1']);
  });

  it('proposes a quedada with camelCase p_session and reads it back', async () => {
    const session = { id: 'j1', organizerId: 'me', sport: 'run', date: '2026-10-29', startTime: '19:00', durationMin: 50, intensity: 'vo2', title: 'Series', status: 'proposed', participants: [], createdAt: NOW.toISOString() };
    const { repo, calls } = repoWith({
      'rpc:propose_joint_session': { data: 'j1', error: null },
      'rpc:get_joint_session': { data: session, error: null },
    });
    const created = await repo.proposeJointSession({ sport: 'run', date: '2026-10-29', startTime: '19:00', durationMin: 50, intensity: 'vo2', title: 'Series', inviteeIds: ['alex'] });
    expect(created).toMatchObject({ id: 'j1', status: 'proposed' });
    const args = calls[0]?.args[0] as { p_session: Record<string, unknown>; p_invitees: string[] };
    expect(args.p_session).toMatchObject({ startTime: '19:00', durationMin: 50, title: 'Series' });
    expect(args.p_invitees).toEqual(['alex']);
    expect(calls[1]).toMatchObject({ target: 'rpc:get_joint_session', args: [{ p_session_id: 'j1' }] });
  });

  it('maps RPC errors raised by our SQL (hint + Spanish message)', async () => {
    const { repo } = repoWith({
      'rpc:get_friend_week': { data: null, error: { code: '42501', message: 'Solo puedes ver el calendario de tus amigos', details: '', hint: 'forbidden' } },
    });
    await expect(repo.getFriendWeek('x', { from: '2026-10-26', to: '2026-11-01' })).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Solo puedes ver el calendario de tus amigos',
    });
  });

  it('builds connector URLs from created tokens', async () => {
    const { repo } = repoWith({ 'rpc:create_personal_token': { data: { id: 't1', secret: 'rb_abc123', prefix: 'rb_abc123' }, error: null } });
    const created = await repo.createToken('ics', 'Calendario');
    expect(created.url.endsWith('/ics/rb_abc123.ics')).toBe(true);
    expect(created.token).toMatchObject({ id: 't1', scope: 'ics', label: 'Calendario' });
  });

  it('calls the garmin function with an action', async () => {
    const { client } = fakeClient({ 'rpc:integration_status': { data: [], error: null } });
    const repo = createSupabaseRepository({ client, now: () => NOW });
    await repo.connectGarmin('0123456789abcdef-key', null);
    expect(client.functions.invoke).toHaveBeenCalledWith('garmin', { body: { action: 'connect', apiKey: '0123456789abcdef-key', expiresAt: null } });
  });
});
