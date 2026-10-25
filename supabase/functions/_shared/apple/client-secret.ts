/**
 * Sign in with Apple client secret: an ES256 JWT signed with the SIWA key
 * (.p8, PKCS#8 PEM) from Apple Developer › Keys. Web Crypto only (Deno and
 * Node ≥ 20), no Deno globals. ECDSA signatures from Web Crypto are already
 * in the raw r‖s (IEEE P1363) form that JWS ES256 requires.
 */
import { base64UrlEncode } from '../crypto.ts';
import type { EnvReader } from '../secrets.ts';

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

export interface ClientSecretHeader {
  alg: 'ES256';
  kid: string;
}

export interface ClientSecretClaims {
  iss: string;
  iat: number;
  exp: number;
  aud: string;
  sub: string;
}

const encoder = new TextEncoder();

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
  return { alg: 'ES256', kid: config.keyId };
}

export function clientSecretClaims(config: Pick<AppleConfig, 'teamId' | 'clientId'>, nowSec: number, ttlSec = CLIENT_SECRET_TTL_SEC): ClientSecretClaims {
  const iat = Math.floor(nowSec);
  return { iss: config.teamId, iat, exp: iat + ttlSec, aud: APPLE_AUDIENCE, sub: config.clientId };
}

/** PEM (with real or escaped `\n`) or a bare base64 body → PKCS#8 DER bytes. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error('APPLE_PRIVATE_KEY no es una clave PEM válida.');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

const segment = (value: unknown): string => base64UrlEncode(encoder.encode(JSON.stringify(value)));

/** `header.claims.signature` (ES256) for the token/revoke endpoints. */
export async function signClientSecret(config: AppleConfig, nowSec: number): Promise<string> {
  const key = await importApplePrivateKey(config.privateKey);
  const signingInput = `${segment(clientSecretHeader(config))}.${segment(clientSecretClaims(config, nowSec))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
