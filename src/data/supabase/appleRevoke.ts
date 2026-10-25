/**
 * Sign in with Apple token revocation on account deletion (App Store
 * guideline 5.1.1(v)). Native `signInWithIdToken` never exchanges a code, so
 * no Apple refresh token is stored anywhere: at deletion we ask Apple for a
 * fresh authorization code and the `apple-revoke` edge function exchanges it
 * at appleid.apple.com/auth/token and revokes it at /auth/revoke.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

import { requestAppleAuthorizationCode } from './apple';
import { functionErrorInfo, isNetworkError } from './errors';
import { isRecord } from './narrow';

export type AppleRevokeOutcome = 'not_apple' | 'revoked' | 'skipped' | 'failed';

/** True when the account signed in (or is linked) with Apple. Pure. */
export function isAppleUser(user: Pick<User, 'app_metadata' | 'identities'> | null | undefined): boolean {
  if (!user) return false;
  const meta: unknown = user.app_metadata;
  if (isRecord(meta)) {
    if (meta.provider === 'apple') return true;
    if (Array.isArray(meta.providers) && meta.providers.includes('apple')) return true;
  }
  return (user.identities ?? []).some((identity) => identity.provider === 'apple');
}

function parseRevoked(data: unknown): boolean {
  if (typeof data === 'string') {
    try {
      return parseRevoked(JSON.parse(data) as unknown);
    } catch {
      return false;
    }
  }
  return isRecord(data) && data.revoked === true;
}

async function invokeRevoke(client: SupabaseClient, authorizationCode: string): Promise<AppleRevokeOutcome> {
  try {
    const { data, error } = await client.functions.invoke('apple-revoke', { body: { authorizationCode } });
    if (!error) return parseRevoked(data) ? 'revoked' : 'failed';
    const info = await functionErrorInfo(error);
    if (info.status === 503 || info.errorCode === 'apple_not_configured') {
      logger.info('apple-revoke not configured on the backend; skipping revocation');
      return 'skipped';
    }
    logger.warn('apple-revoke failed', { status: info.status, error: info.errorCode });
    return 'failed';
  } catch (error) {
    logger.warn('apple-revoke threw', isNetworkError(error) ? 'network' : undefined);
    return 'failed';
  }
}

/**
 * Revokes the Apple tokens of the signed-in user, if they use Apple. Throws
 * `cancelled` (deletion must stop) when the user dismisses Apple's sheet; any
 * other problem is logged and deletion goes on (`skipped` / `failed`).
 */
export async function revokeAppleAuthorization(client: SupabaseClient): Promise<AppleRevokeOutcome> {
  const { data } = await client.auth.getSession();
  if (!isAppleUser(data.session?.user)) return 'not_apple';
  const code = await requestAppleAuthorizationCode();
  if (!code) {
    logger.warn('apple revocation skipped: no authorization code on this device');
    return 'skipped';
  }
  const outcome = await invokeRevoke(client, code);
  if (outcome === 'failed') logger.warn('apple tokens not revoked; deleting the account anyway');
  return outcome;
}
