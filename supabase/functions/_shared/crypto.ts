/**
 * Web Crypto helpers (available in Deno and Node ≥ 20 as `crypto.subtle`).
 * - sha256Hex: token hashing, identical to Postgres
 *   `encode(sha256(convert_to(secret,'UTF8')),'hex')`.
 * - constantTimeEqual: secret comparison without early exit.
 * - AES-GCM-256 with a key derived by HKDF-SHA-256 from a server secret, bound
 *   to a context string (e.g. the user id) so ciphertexts cannot be swapped
 *   between users.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CIPHER_VERSION = 'v1';
const HKDF_SALT = 'rti.integration-credentials.v1';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deriveKey(secret: string, context: string): Promise<CryptoKey> {
  if (secret.length < 16) throw new Error('El secreto de cifrado es demasiado corto (mínimo 16 caracteres).');
  const ikm = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(HKDF_SALT), info: encoder.encode(context) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Returns `v1.<iv>.<ciphertext>` (base64url). */
export async function encryptSecret(plaintext: string, secret: string, context: string): Promise<string> {
  const key = await deriveKey(secret, context);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  return `${CIPHER_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(payload: string, secret: string, context: string): Promise<string> {
  const [version, ivPart, ctPart] = payload.split('.');
  if (version !== CIPHER_VERSION || !ivPart || !ctPart) throw new Error('Formato de credencial cifrada desconocido.');
  const key = await deriveKey(secret, context);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(ctPart),
  );
  return decoder.decode(plain);
}

/** Reads the `exp` claim (seconds) of a JWT without verifying it. Null if not a JWT. */
export function jwtExpiration(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1]))) as unknown;
    if (payload && typeof payload === 'object' && 'exp' in payload) {
      const exp = (payload as { exp: unknown }).exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
    }
    return null;
  } catch {
    return null;
  }
}
