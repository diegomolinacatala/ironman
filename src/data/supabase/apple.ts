/**
 * Native Sign in with Apple → Supabase `signInWithIdToken`.
 * Nonce pattern: SHA-256(rawNonce) to Apple, rawNonce to Supabase (Supabase
 * hashes it and compares with the token claim).
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

import { RepositoryError } from '../repository';
import { isRecord } from './narrow';

export interface AppleCredentialResult {
  identityToken: string;
  rawNonce: string;
  /** "Nombre Apellido" — Apple only sends it on the very first authorization. */
  fullName: string | null;
}

export function formatAppleName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName].filter((p): p is string => Boolean(p && p.trim()));
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined.slice(0, 60) : null;
}

async function randomNonce(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isCancel(error: unknown): boolean {
  return isRecord(error) && error.code === 'ERR_REQUEST_CANCELED';
}

async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Asks Apple again for a fresh, single-use authorization code (needed to
 * revoke the Sign in with Apple tokens when the account is deleted).
 * Returns null when Sign in with Apple is not available on this device or
 * Apple returns no code; throws `cancelled` when the user dismisses the sheet.
 */
export async function requestAppleAuthorizationCode(): Promise<string | null> {
  if (!(await isAppleSignInAvailable())) return null;
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? null;
  } catch (error) {
    if (isCancel(error)) {
      throw new RepositoryError('cancelled', 'Has cancelado la confirmación con Apple: tu cuenta no se ha borrado.', error);
    }
    logger.warn('apple re-authorization failed', isRecord(error) ? { code: error.code } : undefined);
    return null;
  }
}

export async function requestAppleCredential(): Promise<AppleCredentialResult> {
  if (!(await isAppleSignInAvailable())) {
    throw new RepositoryError('unavailable', 'Iniciar sesión con Apple solo está disponible en iPhone.');
  }
  const rawNonce = await randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      throw new RepositoryError('unknown', 'Apple no ha devuelto la credencial. Inténtalo de nuevo.');
    }
    return { identityToken: credential.identityToken, rawNonce, fullName: formatAppleName(credential.fullName) };
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    if (isCancel(error)) throw new RepositoryError('cancelled', 'Has cancelado el inicio de sesión con Apple.', error);
    throw new RepositoryError('unknown', 'No se ha podido iniciar sesión con Apple.', error);
  }
}
