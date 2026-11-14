/**
 * Minimal App Store Connect API client (no dependencies): ES256 JWT, JSON:API requests with
 * readable errors, and the upload-operation dance used by screenshots.
 *
 * Env: ASC_KEY_P8 (contents of the .p8), ASC_KEY_ID, ASC_ISSUER_ID — the same secrets ios.yml uses.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const BASE = 'https://api.appstoreconnect.apple.com';
const TOKEN_TTL_S = 15 * 60;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function makeToken({ keyP8, keyId, issuerId }, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + TOKEN_TTL_S, aud: 'appstoreconnect-v1' }));
  const data = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(data), { key: createPrivateKey(keyP8), dsaEncoding: 'ieee-p1363' });
  return `${data}.${signature.toString('base64url')}`;
}

export class AscError extends Error {
  constructor(method, path, status, body) {
    // Submission errors carry the real reasons in meta.associatedErrors ({ "/v1/…/id": [errors] }).
    const describe = (e) => `${e.code}: ${e.detail ?? e.title}`;
    const details = (body?.errors ?? [])
      .flatMap((e) => [describe(e), ...Object.values(e.meta?.associatedErrors ?? {}).flat().map(describe)])
      .join(' | ');
    super(`${method} ${path} → ${status}${details ? ` (${details})` : ''}`);
    this.status = status;
    this.errors = body?.errors ?? [];
  }
}

export function createClient(env = process.env) {
  const creds = { keyP8: env.ASC_KEY_P8 ?? '', keyId: env.ASC_KEY_ID ?? '', issuerId: env.ASC_ISSUER_ID ?? '' };
  if (!creds.keyP8 || !creds.keyId || !creds.issuerId) {
    throw new Error('Faltan ASC_KEY_P8, ASC_KEY_ID y ASC_ISSUER_ID.');
  }
  let token = null;
  let tokenAt = 0;
  const auth = () => {
    const now = Math.floor(Date.now() / 1000);
    if (!token || now - tokenAt > TOKEN_TTL_S - 120) {
      token = makeToken(creds, now);
      tokenAt = now;
    }
    return token;
  };

  async function request(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new AscError(method, path, res.status, json);
    return json;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    /** GET that returns null instead of throwing on 404. */
    async maybe(path) {
      try {
        return await request('GET', path);
      } catch (error) {
        if (error instanceof AscError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

/** Uploads a file through the reservation's uploadOperations; returns the MD5 Apple expects back. */
export async function runUploadOperations(filePath, operations) {
  const bytes = readFileSync(filePath);
  for (const op of operations) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`Subida de ${basename(filePath)} falló (${res.status})`);
  }
  return createHash('md5').update(bytes).digest('hex');
}

export function fileInfo(filePath) {
  return { fileName: basename(filePath), fileSize: statSync(filePath).size };
}

export const rel = (type, id) => ({ data: { type, id } });
