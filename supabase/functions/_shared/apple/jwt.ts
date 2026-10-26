/**
 * ES256 JWTs signed with an Apple Developer key (.p8, PKCS#8 PEM, P-256):
 * the Sign in with Apple client secret and the APNs provider token. Web
 * Crypto only (Deno and Node ≥ 20), no Deno globals. ECDSA signatures from
 * Web Crypto are already in the raw r‖s (IEEE P1363) form that JWS ES256
 * requires.
 */
import { base64UrlEncode } from '../crypto.ts';

export interface Es256Header {
  alg: 'ES256';
  kid: string;
}

const encoder = new TextEncoder();

/** PEM (with real or escaped `\n`) or a bare base64 body → PKCS#8 DER bytes. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error('La clave privada (.p8) no es un PEM válido.');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Imports the .p8 key for signing; rejects when it is not a P-256 PKCS#8 key. */
export function importP8PrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export function es256Header(keyId: string): Es256Header {
  return { alg: 'ES256', kid: keyId };
}

const segment = (value: unknown): string => base64UrlEncode(encoder.encode(JSON.stringify(value)));

/** `header.claims.signature` (compact JWS, ES256). */
export async function signEs256Jwt(key: CryptoKey, header: Es256Header, claims: Record<string, unknown>): Promise<string> {
  const signingInput = `${segment(header)}.${segment(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
