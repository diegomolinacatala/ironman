/**
 * Edge-runtime glue shared by the entry points. Receives the environment as a
 * reader function (the entry point passes `Deno.env.get`), so this module has
 * no Deno globals.
 */
import { errorResponse } from '../http.ts';
import { createLogger } from '../log.ts';
import type { Logger } from '../log.ts';
import { primaryServiceKey } from '../secrets.ts';
import type { EnvReader } from '../secrets.ts';
import { createAdminClient } from './db.ts';
import type { Db } from './db.ts';

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}

/** Keeps a task alive after the response (EdgeRuntime.waitUntil); falls back to fire-and-forget. */
export function runInBackground(task: Promise<unknown>, logger: Logger): void {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  const guarded = task.catch((error: unknown) => logger.error('background task failed', { error }));
  if (runtime && typeof runtime.waitUntil === 'function') runtime.waitUntil(guarded);
}

export interface EdgeContext {
  db: Db | null;
  logger: Logger;
}

/** Builds the admin client once per isolate. `db` is null when the env is incomplete. */
export function edgeContext(fn: string, env: EnvReader): EdgeContext {
  const logger = createLogger({ fn });
  const url = env('SUPABASE_URL');
  const key = primaryServiceKey(env);
  if (!url || !key) {
    logger.error('missing SUPABASE_URL or server key');
    return { db: null, logger };
  }
  return { db: createAdminClient(url, key), logger };
}

export function misconfigured(): Response {
  return errorResponse(500, 'server_misconfigured', 'El servidor no está configurado correctamente.');
}

export const systemNow = (): Date => new Date();
