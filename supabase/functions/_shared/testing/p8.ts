/** Test doubles for Apple .p8 keys (P-256, PKCS#8 PEM) and ES256 JWTs. */
import { base64UrlDecode } from '../crypto.ts';

export interface TestP8Key {
  pem: string;
  publicKey: CryptoKey;
}

const decoder = new TextDecoder();

export async function generateTestP8(): Promise<TestP8Key> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

export const decodeJwtPart = (part: string): Record<string, unknown> => JSON.parse(decoder.decode(base64UrlDecode(part))) as Record<string, unknown>;

/** True when `jwt` is a compact ES256 JWS (raw r‖s signature) valid for `publicKey`. */
export async function verifyEs256(jwt: string, publicKey: CryptoKey): Promise<boolean> {
  const [header, payload, signature] = jwt.split('.');
  const raw = base64UrlDecode(signature ?? '');
  if (raw.length !== 64) return false;
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, raw, new TextEncoder().encode(`${header}.${payload}`));
}
