/**
 * Shared plumbing for the Supabase repository modules: the per-repository
 * context (client + current user) and result unwrapping with error mapping.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { UUID } from '@/domain/types';
import { logger } from '@/lib/logger';

import { RepositoryError } from '../repository';
import { MESSAGES, toRepositoryError } from './errors';
import { isRecord } from './narrow';

export interface SupabaseCtx {
  readonly client: SupabaseClient;
  /** Id of the signed-in user; throws `not_authenticated` otherwise. */
  userId(): Promise<UUID>;
  /** Current time (ISO), injectable for tests. */
  now(): string;
}

export function createCtx(client: SupabaseClient, now: () => Date = () => new Date()): SupabaseCtx {
  return {
    client,
    now: () => now().toISOString(),
    async userId() {
      const { data, error } = await client.auth.getSession();
      if (error) throw toRepositoryError(error, MESSAGES.notAuthenticated);
      const id = data.session?.user.id;
      if (!id) throw new RepositoryError('not_authenticated', 'Inicia sesión para continuar.');
      return id;
    },
  };
}

export interface RawResult {
  data: unknown;
  error: unknown;
}

function logFailure(label: string, error: unknown): void {
  const code = isRecord(error) ? error.code : undefined;
  logger.warn(`supabase ${label} failed`, { code });
}

/** Awaits a PostgREST/RPC builder and returns `data` (typed by the caller). */
export async function run<T>(label: string, op: PromiseLike<RawResult>, fallback?: string): Promise<T> {
  let result: RawResult;
  try {
    result = await op;
  } catch (error) {
    logFailure(label, error);
    throw toRepositoryError(error, fallback);
  }
  if (result.error) {
    logFailure(label, result.error);
    throw toRepositoryError(result.error, fallback);
  }
  return result.data as T;
}

/** Like `run` but a null/empty result becomes `not_found`. */
export async function runOne<T>(label: string, op: PromiseLike<RawResult>, notFound: string): Promise<T> {
  const data = await run<T | null>(label, op);
  if (data === null || data === undefined) throw new RepositoryError('not_found', notFound);
  return data;
}

export async function runVoid(label: string, op: PromiseLike<RawResult>, fallback?: string): Promise<void> {
  await run<unknown>(label, op, fallback);
}

/** Local midnight (device timezone) of an ISO date, as an ISO timestamp. */
export function localDayStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString();
}

/** Local midnight of the day AFTER `date` (exclusive range end). */
export function localDayEndIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).toISOString();
}
