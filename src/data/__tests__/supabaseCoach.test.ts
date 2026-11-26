/// <reference types="jest" />
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CoachRequest, PlanProposal } from '@/domain/types';

import type { SupabaseCtx } from '../supabase/base';
import { COACH_NOTICES, createCoachRequester, failureNotice, parseJobId } from '../supabase/coach';
import { createSupabaseRepository } from '../supabase/SupabaseRepository';
import type { RulesCoachRepo } from '../demo/rulesCoach';
import { fakeClient } from './supabaseFake';

const mockRunRulesCoach = jest.fn();
const mockRunRulesFirst = jest.fn(async (..._args: unknown[]): Promise<unknown> => null);
jest.mock('../demo/rulesCoach', () => ({
  runRulesCoach: (...args: unknown[]) => mockRunRulesCoach(...args),
  runRulesFirst: (...args: unknown[]) => mockRunRulesFirst(...args),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// `env` is read on every request, so each test can flip the AI coach flag.
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true, coachRulesFirst: true } };
});
const mockEnv = jest.requireMock<{ env: { aiCoachEnabled: boolean; coachRulesFirst: boolean } }>('@/lib/env').env;

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
  it('a concrete change the rules engine is sure about is answered first: no AI job', async () => {
    const instant = { reply: 'Paso «Rodaje» al jueves.', proposal: PROPOSAL, engine: 'rules', instant: true, memory: [], lifeEvent: null };
    mockRunRulesFirst.mockResolvedValueOnce(instant);
    const ctx = fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'done', engine: 'ai' }]);
    const chat: CoachRequest = { mode: 'chat', weekStart: '2026-10-26', message: 'Mueve el rodaje al jueves' };
    expect(await createCoachRequester({ ...fastDeps, ctx })(chat)).toEqual(instant);
    expect(mockRunRulesFirst).toHaveBeenCalledWith(repo, chat, { today: '2026-10-25' });
    expect(ctx.client.functions.invoke).not.toHaveBeenCalled();
  });

  it('with rules-first off, or when it has nothing, the AI answers', async () => {
    const ctx = fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'done', reply: 'IA', engine: 'ai' }]);
    const chat: CoachRequest = { mode: 'chat', weekStart: '2026-10-26', message: '¿Qué opinas de mi semana?' };
    expect((await createCoachRequester({ ...fastDeps, ctx })(chat)).reply).toBe('IA');
    mockEnv.coachRulesFirst = false;
    mockRunRulesFirst.mockClear();
    const ctx2 = fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'done', reply: 'IA', engine: 'ai' }]);
    await createCoachRequester({ ...fastDeps, ctx: ctx2 })(chat);
    expect(mockRunRulesFirst).not.toHaveBeenCalled();
    mockEnv.coachRulesFirst = true;
  });

  it('polls the job and returns the AI proposal', async () => {
    const ctx = fakeCtx({ data: { jobId: 'job' }, error: null }, [
      { status: 'running' },
      { status: 'done', reply: '¡Hecho!', proposal_id: 'p1', engine: 'ai' },
    ]);
    const response = await createCoachRequester({ ...fastDeps, ctx })(REQUEST);
    expect(response).toEqual({ reply: '¡Hecho!', proposal: PROPOSAL, engine: 'ai', memory: [], lifeEvent: null, quedada: null });
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

  it('says why the AI job failed (quota, cut answer…) before the rules answer', async () => {
    const quota = 'La IA gratuita ha llegado a su límite de hoy. Vuelve a intentarlo mañana.';
    await createCoachRequester({ ...fastDeps, ctx: fakeCtx({ data: { jobId: 'job' }, error: null }, [{ status: 'error', error: quota }]) })(REQUEST);
    const notice = (mockRunRulesCoach.mock.calls.at(-1)?.[2] as { notice: string }).notice;
    expect(notice).toBe(`${quota} Mientras, te respondo con el motor de reglas.`);
    expect(failureNotice('El coach con IA ha tardado demasiado. Te propongo el plan automático mientras tanto.')).toBe(
      'El coach con IA ha tardado demasiado. Mientras, te respondo con el motor de reglas.',
    );
    expect(failureNotice('Reformúlala o usa el plan automático')).toBe('Reformúlala. Mientras, te respondo con el motor de reglas.');
    expect(failureNotice(null)).toBe(COACH_NOTICES.failed);
    expect(failureNotice('  ')).toBe(COACH_NOTICES.failed);
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
