/// <reference types="jest" />
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PlanProposal } from '@/domain/types';

import type { SupabaseCtx } from '../supabase/base';
import { createCoachRequester } from '../supabase/coach';
import { MEAL_IMAGE_MAX_BASE64, MEAL_MESSAGES, MEAL_TIMEOUT_MS, mealApi } from '../supabase/mealApi';
import type { RulesCoachRepo } from '../demo/rulesCoach';

jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true } };
});
const mockEnv = jest.requireMock<{ env: { aiCoachEnabled: boolean } }>('@/lib/env').env;

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

beforeEach(() => {
  mockEnv.aiCoachEnabled = true;
});

const NOW = '2026-10-27T12:30:00.000Z';
const INPUT = { date: '2026-10-27', time: '14:30', text: '  pasta con atún  ' };

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', message: 'non-2xx', context: new Response(JSON.stringify(body), { status }) };
}

function invokeCtx(result: { data: unknown; error: unknown }) {
  const invoke = jest.fn(async (_name: string, _options: Record<string, unknown>) => result);
  const client = { functions: { invoke }, from: jest.fn() } as unknown as SupabaseClient;
  const ctx: SupabaseCtx = { client, userId: async () => 'me', now: () => NOW };
  return { ctx, invoke };
}

describe('Supabase analyzeMeal', () => {
  it('estimates locally when the AI is off', async () => {
    mockEnv.aiCoachEnabled = false;
    const { ctx, invoke } = invokeCtx({ data: null, error: null });
    const result = await mealApi(ctx).analyzeMeal(INPUT);
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({ engine: 'rules', confidence: 'low', meal: 'lunch', description: 'Pasta con atún' });
  });

  it('sends the cleaned input to the meal function and validates the answer', async () => {
    const analysis = { meal: 'lunch', description: 'Pasta con atún', items: ['Pasta · 250 g'], kcal: 600, carbsG: 80, proteinG: 30, fatG: 12, confidence: 'high', tip: null, engine: 'ai' };
    const { ctx, invoke } = invokeCtx({ data: analysis, error: null });
    const result = await mealApi(ctx).analyzeMeal({ ...INPUT, imageBase64: ' abc ' });
    expect(result).toEqual(analysis);
    expect(invoke).toHaveBeenCalledWith('meal', {
      body: { date: '2026-10-27', time: '14:30', text: 'pasta con atún', imageBase64: 'abc' },
      timeout: MEAL_TIMEOUT_MS,
    });
  });

  it('turns 413 into a validation error', async () => {
    const { ctx } = invokeCtx({ data: null, error: httpError(413, { error: 'too_large' }) });
    await expect(mealApi(ctx).analyzeMeal(INPUT)).rejects.toMatchObject({ code: 'validation', message: MEAL_MESSAGES.tooLarge });
  });

  it.each([
    ['AI unavailable', { data: null, error: httpError(503, { error: 'ai_unavailable' }) }],
    ['no consent', { data: null, error: httpError(403, { error: 'consent_required' }) }],
    ['rate limited', { data: null, error: httpError(429, { error: 'rate_limited' }) }],
    ['bad gateway', { data: null, error: httpError(502, {}) }],
    ['timeout', { data: null, error: { name: 'FunctionsFetchError', message: 'x', context: { name: 'AbortError' } } }],
    ['unusable answer', { data: { items: [] }, error: null }],
  ])('falls back to the local estimate: %s', async (_label, result) => {
    const { ctx } = invokeCtx(result);
    expect(await mealApi(ctx).analyzeMeal(INPUT)).toMatchObject({ engine: 'rules', items: ['Pasta cocida · 250 g', 'Atún · 80 g'] });
  });

  it('throws for expired sessions and offline', async () => {
    await expect(mealApi(invokeCtx({ data: null, error: httpError(401, {}) }).ctx).analyzeMeal(INPUT)).rejects.toMatchObject({
      code: 'not_authenticated',
    });
    const offline = { name: 'FunctionsFetchError', message: 'Failed to send a request', context: new TypeError('Network request failed') };
    await expect(mealApi(invokeCtx({ data: null, error: offline }).ctx).analyzeMeal(INPUT)).rejects.toMatchObject({ code: 'network' });
  });

  it('validates the input before calling the function', async () => {
    const { ctx, invoke } = invokeCtx({ data: null, error: null });
    const api = mealApi(ctx);
    await expect(api.analyzeMeal({ date: '2026-10-27', time: '14:30', text: '  ' })).rejects.toMatchObject({ message: MEAL_MESSAGES.empty });
    await expect(api.analyzeMeal({ ...INPUT, time: '25:00' })).rejects.toMatchObject({ message: MEAL_MESSAGES.invalidDate });
    const huge = 'a'.repeat(MEAL_IMAGE_MAX_BASE64 + 1);
    await expect(api.analyzeMeal({ ...INPUT, imageBase64: huge })).rejects.toMatchObject({ message: MEAL_MESSAGES.tooLarge });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('Supabase coach memory and life event (coach_jobs.extras)', () => {
  const EVENT_ID = '11111111-2222-4333-8444-555555555555';
  const EVENT_ROW = {
    id: EVENT_ID,
    user_id: 'me',
    kind: 'injury',
    title: 'Molestia en el tobillo',
    start_date: '2026-10-27',
    end_date: '2026-10-29',
    start_time: null,
    duration_min: null,
    severity: 2,
    body_area: 'ankle',
    notes: null,
    created_at: NOW,
  };

  function coachCtx(extras: unknown, lifeEvent: unknown): SupabaseCtx {
    const from = jest.fn((table: string) => {
      let columns = '';
      const builder = {
        select: (c: string) => {
          columns = c;
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'life_events') return { data: lifeEvent, error: null };
          if (columns === 'extras') {
            return extras === 'missing-column' ? { data: null, error: { code: '42703', message: 'column does not exist' } } : { data: { extras }, error: null };
          }
          return { data: { id: 'job', user_id: 'me', status: 'done', reply: 'Hecho', proposal_id: null, engine: 'ai', error: null }, error: null };
        },
      };
      return builder;
    });
    const client = { functions: { invoke: jest.fn(async () => ({ data: { jobId: 'job' }, error: null })) }, from } as unknown as SupabaseClient;
    return { client, userId: async () => 'me', now: () => NOW };
  }

  const repo = { getProposal: jest.fn(async () => null) } as unknown as RulesCoachRepo & {
    getProposal: (id: string) => Promise<PlanProposal | null>;
  };
  const deps = { repo, today: () => '2026-10-27', sleep: async () => undefined, pollIntervalMs: 2000, maxWaitMs: 4000 };
  const request = { mode: 'chat' as const, weekStart: '2026-10-26', message: 'me duele el tobillo', channel: 'voice' as const };

  it('passes the channel and returns the memory and the logged life event', async () => {
    const ctx = coachCtx({ memory: ['Prefiere nadar por la mañana'], lifeEventId: EVENT_ID }, EVENT_ROW);
    const response = await createCoachRequester({ ...deps, ctx })(request);
    expect(ctx.client.functions.invoke).toHaveBeenCalledWith('coach', { body: request });
    expect(response).toMatchObject({ reply: 'Hecho', engine: 'ai', memory: ['Prefiere nadar por la mañana'] });
    expect(response.lifeEvent).toMatchObject({ id: EVENT_ID, kind: 'injury', bodyArea: 'ankle', severity: 2 });
  });

  it('still answers when the extras or the life event cannot be read', async () => {
    const missing = await createCoachRequester({ ...deps, ctx: coachCtx('missing-column', null) })(request);
    expect(missing).toMatchObject({ reply: 'Hecho', memory: [], lifeEvent: null });
    const gone = await createCoachRequester({ ...deps, ctx: coachCtx({ memory: [], lifeEventId: EVENT_ID }, null) })(request);
    expect(gone.lifeEvent).toBeNull();
  });
});
