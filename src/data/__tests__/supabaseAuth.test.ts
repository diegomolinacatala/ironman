/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

import { StorageKeys } from '@/lib/storage';

import { createSupabaseAuth } from '../supabase/auth';
import { isAppleUser } from '../supabase/appleRevoke';
import { parseStoredPushToken } from '../supabase/pushToken';
import { chainArgs, fakeClient, type FakeResponses } from './supabaseFake';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(async () => ({
    identityToken: 'apple-id-token',
    authorizationCode: 'apple-auth-code',
    fullName: { givenName: 'Diego', familyName: 'Molina', middleName: null, namePrefix: null, nameSuffix: null, nickname: null },
  })),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(171)),
  digestStringAsync: jest.fn(async () => 'sha256-of-raw-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
}));

// Best-effort failures are logged as warnings by design; keep test output clean.
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

const EMAIL_SESSION = { user: { id: 'me', email: 'abc123@privaterelay.appleid.com' } };
const APPLE_SESSION = {
  user: { ...EMAIL_SESSION.user, app_metadata: { provider: 'apple', providers: ['apple'] }, identities: [] },
};
const PUSH_TOKEN = 'deadbeef01';

type InvokeResult = { data: unknown; error: unknown };

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', message: 'non-2xx', context: new Response(JSON.stringify(body), { status }) };
}

function authClient(options: { session?: unknown; responses?: FakeResponses; invoke?: InvokeResult } = {}) {
  const { client, calls } = fakeClient({
    profiles: { data: { display_name: 'abc123', onboarded_at: null }, error: null },
    'rpc:delete_my_account': { data: null, error: null },
    'rpc:unregister_push_token': { data: null, error: null },
    ...options.responses,
  });
  const session = options.session ?? EMAIL_SESSION;
  const auth = {
    getSession: jest.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithOtp: jest.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: jest.fn(async (code: string) =>
      code === 'good-code' ? { data: { session }, error: null } : { data: { session: null }, error: { message: 'invalid' } },
    ),
    verifyOtp: jest.fn(async () => ({ data: { session }, error: null })),
    signInWithIdToken: jest.fn(async () => ({ data: { session }, error: null })),
    updateUser: jest.fn(async () => ({ data: {}, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  const invoke = jest.fn(async () => options.invoke ?? { data: { revoked: true }, error: null });
  const full = Object.assign(client, { auth, functions: { invoke } }) as unknown as SupabaseClient;
  const rpc = jest.spyOn(full, 'rpc');
  return { client: full, auth, calls, invoke, rpc };
}

function appleMock(): { signInAsync: jest.Mock } {
  return jest.requireMock('expo-apple-authentication') as { signInAsync: jest.Mock };
}

/** Invocation order of the first call of `fn` whose first argument is `name`. */
function orderOf(mock: jest.SpyInstance | jest.Mock, name?: string): number {
  const index = name === undefined ? 0 : mock.mock.calls.findIndex((args: unknown[]) => args[0] === name);
  return mock.mock.invocationCallOrder[index] ?? -1;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  appleMock().signInAsync.mockClear();
});

describe('Supabase auth', () => {
  it('sends and verifies email OTP codes', async () => {
    const { client, auth } = authClient();
    const api = createSupabaseAuth(client);
    await expect(api.sendEmailCode('no-email')).rejects.toMatchObject({ code: 'validation' });
    await api.sendEmailCode(' Diego@Example.com ');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'diego@example.com',
      options: { shouldCreateUser: true, emailRedirectTo: 'roadtoironman://auth/callback' },
    });
    await expect(api.verifyEmailCode('diego@example.com', '12')).rejects.toMatchObject({ code: 'validation' });
    const session = await api.verifyEmailCode('diego@example.com', '123 456');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'diego@example.com', token: '123456', type: 'email' });
    expect(session).toEqual({ userId: 'me', email: EMAIL_SESSION.user.email });
    expect(await api.getSession()).toEqual({ userId: 'me', email: EMAIL_SESSION.user.email });
  });

  it('completes the sign-in from the email link (PKCE code)', async () => {
    const { client, auth } = authClient();
    const api = createSupabaseAuth(client);
    await expect(api.completeEmailLink('  ')).rejects.toMatchObject({ code: 'validation' });
    const session = await api.completeEmailLink('good-code');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('good-code');
    expect(session).toEqual({ userId: 'me', email: EMAIL_SESSION.user.email });
    await expect(api.completeEmailLink('expired')).rejects.toBeTruthy();
  });

  it('signs in with Apple using a hashed nonce and stores the full name once', async () => {
    const { client, auth, calls } = authClient();
    const session = await createSupabaseAuth(client).signInWithApple();
    expect(session.userId).toBe('me');
    expect(appleMock().signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'sha256-of-raw-nonce' });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'ab'.repeat(32) });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Diego Molina' } });
    const update = calls.find((c) => c.target === 'profiles' && chainArgs(c, 'update'));
    expect(chainArgs(update, 'update')?.[0]).toEqual({ display_name: 'Diego Molina' });
  });

  it('deletes an email account through the RPC without asking Apple', async () => {
    const { client, auth, calls, invoke } = authClient();
    await createSupabaseAuth(client).deleteAccount();
    expect(calls.some((c) => c.target === 'rpc:delete_my_account')).toBe(true);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(appleMock().signInAsync).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('push token cleanup', () => {
  it('unregisters the stored token before signing out and forgets it locally', async () => {
    await AsyncStorage.setItem(StorageKeys.pushToken, JSON.stringify(PUSH_TOKEN));
    const { client, auth, rpc } = authClient();
    await createSupabaseAuth(client).signOut();
    expect(rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: PUSH_TOKEN });
    expect(orderOf(rpc, 'unregister_push_token')).toBeLessThan(orderOf(auth.signOut));
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBeNull();
  });

  it('never blocks sign-out: RPC errors are ignored and the key is still cleared', async () => {
    await AsyncStorage.setItem(StorageKeys.pushToken, JSON.stringify(PUSH_TOKEN));
    const { client, auth } = authClient({
      responses: { 'rpc:unregister_push_token': { data: null, error: { code: '08006', message: 'offline' } } },
    });
    await createSupabaseAuth(client).signOut();
    expect(auth.signOut).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBeNull();
  });

  it('falls back to deleting the own push_tokens row when the RPC is not deployed', async () => {
    await AsyncStorage.setItem(StorageKeys.pushToken, JSON.stringify(PUSH_TOKEN));
    const { client, calls } = authClient({
      responses: { 'rpc:unregister_push_token': { data: null, error: { code: 'PGRST202', message: 'missing' } } },
    });
    await createSupabaseAuth(client).signOut();
    const del = calls.find((c) => c.target === 'push_tokens');
    expect(chainArgs(del, 'delete')).toEqual([]);
    expect(chainArgs(del, 'eq')).toEqual(['token', PUSH_TOKEN]);
  });

  it('skips the RPC when no token is stored and unregisters on account deletion', async () => {
    const signedOut = authClient();
    await createSupabaseAuth(signedOut.client).signOut();
    expect(signedOut.rpc).not.toHaveBeenCalled();

    await AsyncStorage.setItem(StorageKeys.pushToken, JSON.stringify(PUSH_TOKEN));
    const deleting = authClient();
    await createSupabaseAuth(deleting.client).deleteAccount();
    expect(orderOf(deleting.rpc, 'unregister_push_token')).toBeLessThan(orderOf(deleting.rpc, 'delete_my_account'));
  });

  it('parses the stored value (JSON string or raw text)', () => {
    expect(parseStoredPushToken(JSON.stringify(PUSH_TOKEN))).toBe(PUSH_TOKEN);
    expect(parseStoredPushToken(PUSH_TOKEN)).toBe(PUSH_TOKEN);
    expect(parseStoredPushToken(null)).toBeNull();
    expect(parseStoredPushToken('""')).toBeNull();
    expect(parseStoredPushToken('42')).toBeNull();
  });
});

describe('Sign in with Apple revocation on account deletion', () => {
  it('re-authorizes with Apple, revokes through apple-revoke, then deletes the account', async () => {
    const { client, invoke, rpc } = authClient({ session: APPLE_SESSION });
    await createSupabaseAuth(client).deleteAccount();
    expect(appleMock().signInAsync).toHaveBeenCalledWith({ requestedScopes: [] });
    expect(invoke).toHaveBeenCalledWith('apple-revoke', { body: { authorizationCode: 'apple-auth-code' } });
    expect(orderOf(invoke)).toBeLessThan(orderOf(rpc, 'delete_my_account'));
  });

  it('keeps the account when the user cancels the Apple sheet', async () => {
    appleMock().signInAsync.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
    const { client, auth, rpc } = authClient({ session: APPLE_SESSION });
    await expect(createSupabaseAuth(client).deleteAccount()).rejects.toMatchObject({ code: 'cancelled' });
    expect(rpc).not.toHaveBeenCalledWith('delete_my_account');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('still deletes the account when the backend has no Apple key (503) or revocation fails', async () => {
    const notConfigured = authClient({
      session: APPLE_SESSION,
      invoke: { data: null, error: httpError(503, { error: 'apple_not_configured' }) },
    });
    await createSupabaseAuth(notConfigured.client).deleteAccount();
    expect(notConfigured.rpc).toHaveBeenCalledWith('delete_my_account');

    const failing = authClient({ session: APPLE_SESSION, invoke: { data: null, error: httpError(502, {}) } });
    await createSupabaseAuth(failing.client).deleteAccount();
    expect(failing.rpc).toHaveBeenCalledWith('delete_my_account');
  });

  it('detects Apple accounts from app_metadata or identities', () => {
    expect(isAppleUser(APPLE_SESSION.user)).toBe(true);
    expect(isAppleUser({ app_metadata: { providers: ['email', 'apple'] }, identities: [] })).toBe(true);
    expect(isAppleUser({ app_metadata: {}, identities: [{ provider: 'apple' } as never] })).toBe(true);
    expect(isAppleUser({ app_metadata: { provider: 'email', providers: ['email'] }, identities: [] })).toBe(false);
    expect(isAppleUser(null)).toBe(false);
  });
});
