/// <reference types="jest" />
import { AuthApiError } from '@supabase/supabase-js';

import { RepositoryError } from '../repository';
import { authError } from '../supabase/auth';
import { MESSAGES, functionErrorInfo, toFunctionError, toRepositoryError } from '../supabase/errors';
import { topicsForChange } from '../supabase/realtime';
import { parseApplyRpc } from '../supabase/workoutsApi';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function pg(code: string, message = 'boom', details = '') {
  return { code, message, details, hint: '' };
}

describe('toRepositoryError', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PGRST301', 'forbidden'],
    ['23505', 'conflict'],
    ['PGRST116', 'not_found'],
    ['23514', 'validation'],
    ['PGRST202', 'unavailable'],
  ])('maps %s → %s', (code, expected) => {
    expect(toRepositoryError(pg(code)).code).toBe(expected);
  });

  it('keeps the raised message for P0001 (RAISE EXCEPTION)', () => {
    const e = toRepositoryError(pg('P0001', 'Ya sois amigos'));
    expect(e.code).toBe('validation');
    expect(e.message).toBe('Ya sois amigos');
  });

  it('uses the Spanish message and kind raised by our RPCs (hint)', () => {
    const e = toRepositoryError({ code: '22023', message: 'Solo puedes ver hasta 31 días', details: '', hint: 'validation' });
    expect(e).toMatchObject({ code: 'validation', message: 'Solo puedes ver hasta 31 días' });
    expect(toRepositoryError({ code: '23505', message: 'Ya sois amigos', details: '', hint: 'conflict' }).message).toBe('Ya sois amigos');
    expect(toRepositoryError({ code: 'P0001', message: 'Límite', details: '', hint: 'rate_limited' }).code).toBe('rate_limited');
    expect(toRepositoryError({ code: '42501', message: 'x', details: '', hint: 'Perhaps you meant' }).message).toBe(MESSAGES.forbidden);
  });

  it('detects username conflicts', () => {
    expect(toRepositoryError(pg('23505', 'duplicate key value violates unique constraint "profiles_username_key"')).message).toBe(
      MESSAGES.usernameTaken,
    );
  });

  it('maps network failures', () => {
    expect(toRepositoryError(new TypeError('Network request failed')).code).toBe('network');
    expect(toRepositoryError(pg('', 'TypeError: Failed to fetch')).code).toBe('network');
  });

  it('passes RepositoryError through and falls back to unknown', () => {
    const original = new RepositoryError('conflict', 'x');
    expect(toRepositoryError(original)).toBe(original);
    expect(toRepositoryError('???', 'Fallback').message).toBe('Fallback');
  });
});

describe('edge function errors', () => {
  const httpError = (status: number, body: unknown) => ({
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  });

  it('reads status and error code from the response body', async () => {
    await expect(functionErrorInfo(httpError(503, { error: 'ai_unavailable' }))).resolves.toEqual({
      status: 503,
      errorCode: 'ai_unavailable',
      message: null,
    });
  });

  it('maps HTTP statuses', async () => {
    expect((await toFunctionError(httpError(429, {}), 'f')).code).toBe('rate_limited');
    expect((await toFunctionError(httpError(400, { message: 'Clave no válida' }), 'f')).message).toBe('Clave no válida');
    expect((await toFunctionError({ name: 'FunctionsFetchError', message: 'Failed to send a request' }, 'f')).code).toBe('network');
  });
});

describe('auth errors', () => {
  it('maps OTP and rate-limit codes to Spanish messages', () => {
    expect(authError(new AuthApiError('Token has expired', 403, 'otp_expired'), 'f').code).toBe('validation');
    expect(authError(new AuthApiError('Too many', 429, 'over_email_send_rate_limit'), 'f').code).toBe('rate_limited');
  });
});

describe('realtime topic mapping', () => {
  it('maps tables and notification types to topics', () => {
    expect(topicsForChange('workouts', {})).toEqual(['workouts']);
    expect(topicsForChange('coach_jobs', {})).toEqual(['proposals']);
    expect(topicsForChange('friendships', {})).toEqual(['friends', 'feed']);
    expect(topicsForChange('notifications', { new: { type: 'joint_response' } })).toEqual([
      'notifications',
      'joint_sessions',
      'workouts',
    ]);
    expect(topicsForChange('unknown_table', {})).toEqual([]);
  });
});

describe('RPC payload parsing', () => {
  it('apply_plan_changes result', () => {
    expect(parseApplyRpc({ applied: 2, failed: [{ index: 1, error: 'Entreno no encontrado' }] })).toEqual({
      applied: 2,
      failed: [{ index: 1, error: 'Entreno no encontrado' }],
    });
    expect(parseApplyRpc(null)).toEqual({ applied: 0, failed: [] });
  });
});
