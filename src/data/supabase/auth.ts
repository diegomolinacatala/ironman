/**
 * AuthApi over Supabase Auth: email OTP (6-digit code) and native Apple.
 */
import { isAuthError, type Session, type SupabaseClient } from '@supabase/supabase-js';

import * as Linking from 'expo-linking';

import { logger } from '@/lib/logger';

import { RepositoryError, type AuthApi, type AuthSession } from '../repository';
import { requestAppleCredential } from './apple';
import { revokeAppleAuthorization } from './appleRevoke';
import { runVoid } from './base';
import { MESSAGES, isNetworkError } from './errors';
import { unregisterStoredPushToken } from './pushToken';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

/** Where the sign-in email link lands: roadtoironman://auth/callback (localhost URL on web). */
export function emailRedirectUrl(): string {
  try {
    return Linking.createURL('auth/callback');
  } catch {
    // No Expo manifest (tests, bare contexts): fall back to the app's fixed scheme.
    return 'roadtoironman://auth/callback';
  }
}

export function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email ?? null };
}

/** Spanish message for Supabase Auth errors. Pure. */
export function authError(error: unknown, fallback: string): RepositoryError {
  if (error instanceof RepositoryError) return error;
  if (isNetworkError(error)) return new RepositoryError('network', MESSAGES.network, error);
  if (!isAuthError(error)) return new RepositoryError('unknown', fallback, error);
  const code = error.code ?? '';
  if (code === 'otp_expired' || code === 'otp_disabled' || code === 'invalid_credentials') {
    return new RepositoryError('validation', 'El código no es válido o ha caducado. Pide uno nuevo.', error);
  }
  if (code.startsWith('over_') || error.status === 429) {
    return new RepositoryError('rate_limited', 'Espera un minuto antes de pedir otro código.', error);
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return new RepositoryError('validation', 'Ese email no parece válido.', error);
  }
  if (code === 'signup_disabled' || code === 'user_banned') {
    return new RepositoryError('forbidden', 'Esta cuenta no puede iniciar sesión ahora mismo.', error);
  }
  if (code === 'session_not_found' || code === 'session_expired' || error.status === 401) {
    return new RepositoryError('not_authenticated', MESSAGES.notAuthenticated, error);
  }
  return new RepositoryError('unknown', fallback, error);
}

function emailLocalPart(email: string | null | undefined): string {
  return (email ?? '').split('@')[0] ?? '';
}

/** Apple only sends the name once: keep it in metadata and in the profile if still default. */
async function storeAppleName(client: SupabaseClient, session: Session, fullName: string): Promise<void> {
  try {
    await client.auth.updateUser({ data: { full_name: fullName } });
    const { data } = await client
      .from('profiles')
      .select('display_name,onboarded_at')
      .eq('id', session.user.id)
      .maybeSingle();
    const row = data as { display_name: string; onboarded_at: string | null } | null;
    if (!row) return;
    const isDefault = !row.onboarded_at || row.display_name === emailLocalPart(session.user.email);
    if (isDefault && row.display_name !== fullName) {
      await runVoid(
        'storeAppleName',
        client.from('profiles').update({ display_name: fullName }).eq('id', session.user.id),
      );
    }
  } catch (error) {
    // Non-blocking: the user can still type the name during onboarding.
    logger.warn('could not store Apple full name', error);
  }
}

export function createSupabaseAuth(client: SupabaseClient): AuthApi {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) {
        logger.warn('getSession failed', error.message);
        return null;
      }
      return toAuthSession(data.session);
    },

    onAuthChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(toAuthSession(session)));
      return () => data.subscription.unsubscribe();
    },

    async sendEmailCode(email) {
      const clean = email.trim().toLowerCase();
      if (!EMAIL_RE.test(clean)) throw new RepositoryError('validation', 'Ese email no parece válido.');
      const { error } = await client.auth.signInWithOtp({
        email: clean,
        options: { shouldCreateUser: true, emailRedirectTo: emailRedirectUrl() },
      });
      if (error) throw authError(error, 'No hemos podido enviarte el código.');
    },

    async completeEmailLink(code) {
      const clean = code.trim();
      if (!clean) throw new RepositoryError('validation', 'El enlace no es válido. Pide uno nuevo.');
      const { data, error } = await client.auth.exchangeCodeForSession(clean);
      if (error) throw authError(error, 'El enlace ha caducado o ya se usó. Pide uno nuevo.');
      const session = toAuthSession(data.session);
      if (!session) throw new RepositoryError('unknown', 'No se ha podido iniciar sesión. Inténtalo de nuevo.');
      return session;
    },

    async verifyEmailCode(email, code) {
      const token = code.replace(/\s/g, '');
      if (!CODE_RE.test(token)) throw new RepositoryError('validation', 'El código tiene 6 dígitos.');
      const { data, error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
      if (error) throw authError(error, 'No hemos podido verificar el código.');
      const session = toAuthSession(data.session);
      if (!session) throw new RepositoryError('unknown', 'No se ha podido iniciar sesión. Inténtalo de nuevo.');
      return session;
    },

    async signInWithApple() {
      const credential = await requestAppleCredential();
      const { data, error } = await client.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: credential.rawNonce,
      });
      if (error) throw authError(error, 'No se ha podido iniciar sesión con Apple.');
      if (!data.session) throw new RepositoryError('unknown', 'No se ha podido iniciar sesión con Apple.');
      if (credential.fullName) await storeAppleName(client, data.session, credential.fullName);
      const session = toAuthSession(data.session);
      if (!session) throw new RepositoryError('unknown', 'No se ha podido iniciar sesión con Apple.');
      return session;
    },

    async signOut() {
      // While the session is still valid: stop this device receiving the account's pushes.
      await unregisterStoredPushToken(client);
      const { error } = await client.auth.signOut();
      if (error) {
        logger.warn('global signOut failed, clearing local session', error.message);
        await client.auth.signOut({ scope: 'local' });
      }
    },

    async deleteAccount() {
      // First, as it can be cancelled: Apple re-authorization + token revocation.
      await revokeAppleAuthorization(client);
      await unregisterStoredPushToken(client);
      await runVoid('deleteAccount', client.rpc('delete_my_account'), 'No se ha podido borrar la cuenta.');
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) logger.warn('local signOut after delete failed', error.message);
    },
  };
}
