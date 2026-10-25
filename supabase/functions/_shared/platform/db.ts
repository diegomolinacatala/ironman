/**
 * Supabase client helpers for the edge runtime (service-role client; RLS is
 * bypassed, so EVERY query in the adapters filters by the resolved user id).
 * No Deno globals: the entry point passes the URL and key.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { UUID } from '../types.ts';

export type Db = SupabaseClient;

export function createAdminClient(url: string, serviceKey: string): Db {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'rebufo-edge/0.1.0' } },
  });
}

export class DbError extends Error {
  readonly code: string | null;
  constructor(context: string, message: string, code: string | null) {
    super(`db ${context}: ${message}`);
    this.name = 'DbError';
    this.code = code;
  }
}

interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** Returns data or throws DbError (no user data in the message). */
export function unwrap<T>(result: PgResult<T>, context: string): T | null {
  if (result.error) throw new DbError(context, result.error.message, result.error.code ?? null);
  return result.data;
}

export function rowsOf(result: PgResult<unknown>, context: string): unknown[] {
  const data = unwrap(result, context);
  return Array.isArray(data) ? data : [];
}

/** svc_resolve_token(sha256(secret), scope) → user id or null. */
export async function resolveToken(db: Db, tokenHash: string, scope: 'mcp' | 'ics'): Promise<UUID | null> {
  const data = unwrap(await db.rpc('svc_resolve_token', { p_token_hash: tokenHash, p_scope: scope }), 'svc_resolve_token');
  return typeof data === 'string' && data.length > 0 ? data : null;
}

/** Verifies the caller's JWT (asymmetric keys: local JWKS check) and returns `sub`. */
export async function userIdFromJwt(db: Db, jwt: string | null): Promise<UUID | null> {
  if (!jwt) return null;
  const { data, error } = await db.auth.getClaims(jwt);
  if (error || !data) return null;
  const sub = data.claims.sub;
  const role = data.claims.role;
  return typeof sub === 'string' && sub.length > 0 && role !== 'anon' ? sub : null;
}
