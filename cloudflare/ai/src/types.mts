/**
 * Minimal typings of the Workers bindings this worker uses (no @cloudflare/workers-types
 * dependency, so it deploys with `npx wrangler deploy` and no npm install).
 */

/** `env.AI` (Workers AI). */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/** `[[ratelimits]]` binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  AI: AiBinding;
  /** Per caller IP (before auth). */
  IP_LIMITER?: RateLimitBinding;
  /** Per app user (`x-ai-client`). */
  CHAT_LIMITER?: RateLimitBinding;
  /** `npx wrangler secret put AI_SHARED_SECRET` (same value as Supabase `AI_WORKER_SECRET`). */
  AI_SHARED_SECRET?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
