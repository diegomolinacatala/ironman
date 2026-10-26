/// <reference types="jest" />
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CoachRequest, PlanProposal } from '@/domain/types';

import type { SupabaseCtx } from '../supabase/base';
import { COACH_NOTICES, createCoachRequester, parseJobId } from '../supabase/coach';
import { createSupabaseRepository } from '../supabase/SupabaseRepository';
import type { RulesCoachRepo } from '../demo/rulesCoach';
import { fakeClient } from './supabaseFake';

const mockRunRulesCoach = jest.fn();
jest.mock('../demo/rulesCoach', () => ({
  runRulesCoach: (...args: unknown[]) => mockRunRulesCoach(...args),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// `env` is read on every request, so each test can flip the AI coach flag.
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true } };
});
const mockEnv = jest.requireMock<{ env: { aiCoachEnabled: boolean } }>('@/lib/env').env;

// Repository failures are logged as warnings by design; keep test output clean.
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const REQUEST: CoachRequest = { mode: 'plan_week', weekStart: '2026-10-26' };
const PROPOSAL: PlanProposal = {
  id: 'p1',
  userId: 'u1',
  kind: 'generate_week',
  source: 'ai_coach',
  weekStart: '2026-10-26',
  summary: 'Semana de base',
  changes: [],
  status: 'pending',
  model: 'claude-opus-5-5',
  createdAt: '2026-10-25T10:00:00.000Z',
};

interface JobRow {
  status: string;
  reply?: string | null;
  proposal_id?: string | null;
  engine?: string | null;
  error?: string | null;
}

function fakeCtx(invokeResult: { data: unknown; error: unknown }, jobs: JobRow[]): SupabaseCtx {
  let poll = 0;
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      const job = jobs[Math.min(poll, jobs.length - 1)];
      poll += 1;
      return { data: job ? { id: 'job', user_id: 'u1', reply: null, proposal_id: null, engine: null, error: null, ...job } : null, error: null };
    },
  };
  const client = {
    functions: { invoke: jest.fn(async () => invokeResult) },
    from: jest.fn(() => builder),
  } as unknown as SupabaseClient;
  return { client, userId: async () => 'u1', now: () => '2026-10-25T10:00:00.000Z' };
}

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', message: 'non-2xx', context: new Response(JSON.stringify(body), { status }) };
}

const repo = { getProposal: jest.fn(async () => PROPOSAL) } as unknown as RulesCoachRepo & {
  getProposal: (id: string) => Promise<PlanProposal | null>;
};

const fastDeps = { repo, today: () => '2026-10-25', sleep: async () => undefined, pollIntervalMs: 2000, maxWaitMs: 6000 };

beforeEach(() => {
  mockEnv.aiCoachEnabled = true;
  mockRunRulesCoach.mockReset();
  mockRunRulesCoach.mockImplementation(async (_repo: unknown, _req: unknown, opts: { notice?: string }) => ({
    reply: `${opts.notice ?? ''} reglas`,
    proposal: null,
    engine: 'rules',
  }));
});

describe('Supabase requestCoach with the AI coach off (default)', () => {
  beforeEach(() => {
    mockEnv.aiCoachEnabled = false;
  });

  it('answers with the rules engine without invoking the coach function or polling jobs', async () => {
    const ctx = fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'done', engine: 'ai' }]);
    const response = await createCoachRequester({ ...fastDeps, ctx })(REQUEST);
    expect(response.engine).toBe('rules');
    expect(response.reply).toBe(' reglas');
    expect(mockRunRulesCoach).toHaveBeenCalledWith(repo, REQUEST, { today: '2026-10-25' });
    expect(ctx.client.functions.invoke).not.toHaveBeenCalled();
    expect(ctx.client.from).not.toHaveBeenCalled();
  });

  it('SupabaseRepository.requestCoach never calls an edge function nor coach_jobs', async () => {
    const { client, calls } = fakeClient({});
    const repository = createSupabaseRepository({ client, now: () => new Date('2026-10-25T10:00:00.000Z') });
    const chat: CoachRequest = { mode: 'chat', weekStart: '2026-10-26', message: 'Me duele la rodilla' };
    const response = await repository.requestCoach(chat);
    expect(response.engine).toBe('rules');
    expect(client.functions.invoke).not.toHaveBeenCalled();
    expect(calls.some((call) => call.target === 'coach_jobs')).toBe(false);
    expect(mockRunRulesCoach).toHaveBeenCalledWith(expect.anything(), chat, { today: '2026-10-25' });
  });
});

describe('Supabase requestCoach with the AI coach on', () => {
  it('polls the job and returns the AI proposal', async () => {
    const ctx = fakeCtx({ data: { jobId: 'job' }, error: null }, [
      { status: 'running' },
      { status: 'done', reply: '¡Hecho!', proposal_id: 'p1', engine: 'ai' },
    ]);
    const response = await createCoachRequester({ ...fastDeps, ctx })(REQUEST);
    expect(response).toEqual({ reply: '¡Hecho!', proposal: PROPOSAL, engine: 'ai' });
    expect(mockRunRulesCoach).not.toHaveBeenCalled();
  });

  it('falls back to the rules engine when AI is unavailable (503)', async () => {
    const ctx = fakeCtx({ data: null, error: httpError(503, { error: 'ai_unavailable' }) }, []);
    const response = await createCoachRequester({ ...fastDeps, ctx })(REQUEST);
    expect(response.engine).toBe('rules');
    expect(mockRunRulesCoach).toHaveBeenCalledWith(repo, REQUEST, { today: '2026-10-25', notice: COACH_NOTICES.unavailable });
  });

  it('falls back when rate limited, when the job fails and on timeout', async () => {
    await createCoachRequester({ ...fastDeps, ctx: fakeCtx({ data: null, error: httpError(429, {}) }, []) })(REQUEST);
    await createCoachRequester({ ...fastDeps, ctx: fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'error', error: 'x' }]) })(REQUEST);
    await createCoachRequester({ ...fastDeps, ctx: fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'running' }]) })(REQUEST);
    const notices = mockRunRulesCoach.mock.calls.map((call) => (call[2] as { notice: string }).notice);
    expect(notices).toEqual([COACH_NOTICES.rateLimited, COACH_NOTICES.failed, COACH_NOTICES.timeout]);
  });

  it('falls back with a consent notice when the user has not accepted AI processing (403)', async () => {
    const body = { error: 'consent_required', message: 'Acepta el uso del coach IA' };
    const ctx = fakeCtx({ data: null, error: httpError(403, body) }, []);
    const response = await createCoachRequester({ ...fastDeps, ctx })(REQUEST);
    expect(response.engine).toBe('rules');
    expect(mockRunRulesCoach).toHaveBeenCalledWith(repo, REQUEST, { today: '2026-10-25', notice: COACH_NOTICES.consentRequired });
    expect(ctx.client.from).not.toHaveBeenCalled();
  });

  it('throws not_authenticated on 401 instead of falling back', async () => {
    const ctx = fakeCtx({ data: null, error: httpError(401, {}) }, []);
    await expect(createCoachRequester({ ...fastDeps, ctx })(REQUEST)).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});

describe('parseJobId', () => {
  it('reads the job id from an object or JSON text', () => {
    expect(parseJobId({ jobId: 'j1' })).toBe('j1');
    expect(parseJobId('{"job_id":"j2"}')).toBe('j2');
    expect(parseJobId('nope')).toBeNull();
  });
});
