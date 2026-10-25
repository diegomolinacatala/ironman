/**
 * Sign in with Apple token revocation (account deletion, App Review 5.1.1(v)):
 * exchange the fresh authorization code at /auth/token, then revoke the
 * refresh token (or the access token) at /auth/revoke. Tokens and codes are
 * never logged or returned; only Apple's error code is reported for logs.
 */
import { signClientSecret } from './client-secret.ts';
import type { AppleConfig } from './client-secret.ts';

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_TIMEOUT_MS = 10_000;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export type RevokeOutcome = { revoked: true } | { revoked: false; reason: string };

interface FormResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<FormResult> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // Apple answers /auth/revoke with an empty body.
  }
  return { ok: res.ok, status: res.status, body };
}

const appleError = (r: FormResult): string => (typeof r.body.error === 'string' ? r.body.error : `http_${r.status}`);

/** Pure: which token to revoke from the /auth/token response (refresh token preferred). */
export function revocableToken(body: Record<string, unknown>): { token: string; hint: 'refresh_token' | 'access_token' } | null {
  if (typeof body.refresh_token === 'string' && body.refresh_token) return { token: body.refresh_token, hint: 'refresh_token' };
  if (typeof body.access_token === 'string' && body.access_token) return { token: body.access_token, hint: 'access_token' };
  return null;
}

export async function revokeWithAuthorizationCode(fetchFn: FetchFn, config: AppleConfig, authorizationCode: string, nowSec: number): Promise<RevokeOutcome> {
  const clientSecret = await signClientSecret(config, nowSec);
  try {
    const exchanged = await postForm(fetchFn, APPLE_TOKEN_URL, {
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });
    if (!exchanged.ok) return { revoked: false, reason: `token_${appleError(exchanged)}` };
    const target = revocableToken(exchanged.body);
    if (!target) return { revoked: false, reason: 'token_missing' };
    const revoked = await postForm(fetchFn, APPLE_REVOKE_URL, {
      client_id: config.clientId,
      client_secret: clientSecret,
      token: target.token,
      token_type_hint: target.hint,
    });
    return revoked.ok ? { revoked: true } : { revoked: false, reason: `revoke_${appleError(revoked)}` };
  } catch (error) {
    return { revoked: false, reason: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network' };
  }
}
