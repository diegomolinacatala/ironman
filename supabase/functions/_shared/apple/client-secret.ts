/**
 * Sign in with Apple client secret: an ES256 JWT signed with the SIWA key
 * (.p8, PKCS#8 PEM) from Apple Developer › Keys (see jwt.ts).
 */
import type { EnvReader } from '../secrets.ts';
import { es256Header, importP8PrivateKey, signEs256Jwt } from './jwt.ts';
import type { Es256Header } from './jwt.ts';

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Short-lived on purpose (Apple allows up to 6 months): one secret per request. */
export const CLIENT_SECRET_TTL_SEC = 300;

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** PKCS#8 PEM of the .p8 key. */
  privateKey: string;
  /** App bundle id (the audience of the native authorization code). */
  clientId: string;
}

export type ClientSecretHeader = Es256Header;

export interface ClientSecretClaims {
  iss: string;
  iat: number;
  exp: number;
  aud: string;
  sub: string;
}

/** Reads APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID; null when any is missing. */
export function appleConfigFromEnv(env: EnvReader): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID')?.trim();
  const keyId = env('APPLE_KEY_ID')?.trim();
  const privateKey = env('APPLE_PRIVATE_KEY')?.trim();
  // Same format as Supabase's Apple client ids: the first entry is the production bundle id.
  const clientId = env('APPLE_CLIENT_ID')?.split(',')[0]?.trim();
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

export function clientSecretHeader(config: Pick<AppleConfig, 'keyId'>): ClientSecretHeader {
  return es256Header(config.keyId);
}

export function clientSecretClaims(config: Pick<AppleConfig, 'teamId' | 'clientId'>, nowSec: number, ttlSec = CLIENT_SECRET_TTL_SEC): ClientSecretClaims {
  const iat = Math.floor(nowSec);
  return { iss: config.teamId, iat, exp: iat + ttlSec, aud: APPLE_AUDIENCE, sub: config.clientId };
}

/** `header.claims.signature` (ES256) for the token/revoke endpoints. */
export async function signClientSecret(config: AppleConfig, nowSec: number): Promise<string> {
  const key = await importP8PrivateKey(config.privateKey);
  return signEs256Jwt(key, clientSecretHeader(config), { ...clientSecretClaims(config, nowSec) });
}
