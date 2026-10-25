/**
 * Server keys from the Edge runtime environment.
 *
 * Supabase injects `SUPABASE_SECRET_KEYS` (JSON object name → `sb_secret_…`)
 * and, for legacy projects, `SUPABASE_SERVICE_ROLE_KEY`. Calls from pg_cron /
 * pg_net send one of them in the `apikey` header.
 */
import { constantTimeEqual } from './crypto.ts';

export type EnvReader = (name: string) => string | undefined;

function parseSecretKeysJson(raw: string | undefined): { name: string; key: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([name, key]) => ({ name, key }));
  } catch {
    return [];
  }
}

/** Every key accepted as "secret" (dedup, non-empty). */
export function secretKeysFromEnv(env: EnvReader): string[] {
  const named = parseSecretKeysJson(env('SUPABASE_SECRET_KEYS')).map((k) => k.key);
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  return [...new Set([...named, ...(legacy ? [legacy] : [])])];
}

/** Key used to build the admin client: `default` secret key, any secret key, then legacy service role. */
export function primaryServiceKey(env: EnvReader): string | null {
  const named = parseSecretKeysJson(env('SUPABASE_SECRET_KEYS'));
  const preferred = named.find((k) => k.name === 'default') ?? named[0];
  return preferred?.key ?? env('SUPABASE_SERVICE_ROLE_KEY') ?? null;
}

/** True when the request carries one of the server keys (apikey header, or Bearer for legacy JWT keys). */
export function hasServiceKey(headers: Headers, keys: readonly string[]): boolean {
  if (keys.length === 0) return false;
  const candidates = [headers.get('apikey'), /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '')?.[1] ?? null]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.trim());
  let match = false;
  for (const candidate of candidates) {
    for (const key of keys) {
      // Evaluate every pair: no early exit on match.
      match = constantTimeEqual(candidate, key) || match;
    }
  }
  return match;
}
