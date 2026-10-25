/**
 * Rate limiting for the secret-URL endpoints (MCP connector, ICS feed), with
 * per-isolate state. Order of checks, so that unauthenticated traffic cannot
 * use up the budget of real users:
 *   1. per-token bucket (a repeated token only throttles itself);
 *   2. negative cache: a token hash that did not resolve is answered without
 *      a DB lookup for `negativeTtlMs`;
 *   3. per-client failure budget (unresolved lookups per IP) before the lookup;
 *   4. token → user lookup;
 *   5. global cap, counted only for requests whose token resolved.
 * Never log the token or its hash.
 */
import type { UUID } from '../types.ts';

export interface RateDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export interface RateLimiterOptions {
  /** Requests per token per window. */
  limit: number;
  windowMs: number;
  /** Requests per window for the whole isolate, counted only once the token resolved (default limit × 20). */
  globalLimit?: number;
  /** Failed token lookups per client per window (default 60). */
  failureLimit?: number;
  /** How long an unknown or revoked token is remembered (default 60 s). */
  negativeTtlMs?: number;
  /** Upper bound of tracked keys per map (memory guard). */
  maxKeys?: number;
}

export interface RateLimiter {
  hitToken(tokenKey: string, nowMs: number): RateDecision;
  hitGlobal(nowMs: number): RateDecision;
  /** Peeks (does not count) the failure budget of a client. */
  checkClient(clientKey: string, nowMs: number): RateDecision;
  /** Counts a failed lookup for the client and remembers the token as unknown. */
  recordFailure(clientKey: string, tokenKey: string, nowMs: number): void;
  isKnownBad(tokenKey: string, nowMs: number): boolean;
}

interface Window {
  start: number;
  count: number;
}

/** Drops expired entries; if still over `max`, drops the oldest ones (Map keeps insertion order). */
function prune<V>(map: Map<string, V>, max: number, expired: (v: V) => boolean): void {
  if (map.size <= max) return;
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  for (const k of map.keys()) {
    if (map.size <= max) break;
    map.delete(k);
  }
}

function fixedWindows(windowMs: number, maxKeys: number) {
  const windows = new Map<string, Window>();
  const current = (key: string, nowMs: number): Window => {
    const w = windows.get(key);
    return !w || nowMs - w.start >= windowMs ? { start: nowMs, count: 0 } : w;
  };
  const decision = (w: Window, allowed: boolean, nowMs: number): RateDecision => ({
    allowed,
    retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - nowMs) / 1000)),
  });
  return {
    bump(key: string, limit: number, nowMs: number): RateDecision {
      prune(windows, maxKeys, (w) => nowMs - w.start >= windowMs);
      const w = current(key, nowMs);
      const next = { start: w.start, count: w.count + 1 };
      windows.set(key, next);
      return decision(next, next.count <= limit, nowMs);
    },
    peek(key: string, limit: number, nowMs: number): RateDecision {
      const w = current(key, nowMs);
      return decision(w, w.count < limit, nowMs);
    },
  };
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const maxKeys = opts.maxKeys ?? 5000;
  const globalLimit = opts.globalLimit ?? opts.limit * 20;
  const failureLimit = opts.failureLimit ?? 60;
  const negativeTtlMs = opts.negativeTtlMs ?? 60_000;
  const tokens = fixedWindows(opts.windowMs, maxKeys);
  const global = fixedWindows(opts.windowMs, 1);
  const failures = fixedWindows(opts.windowMs, maxKeys);
  const unknown = new Map<string, number>();
  return {
    hitToken: (tokenKey, nowMs) => tokens.bump(tokenKey, opts.limit, nowMs),
    hitGlobal: (nowMs) => global.bump('__global__', globalLimit, nowMs),
    checkClient: (clientKey, nowMs) => failures.peek(clientKey, failureLimit, nowMs),
    recordFailure(clientKey, tokenKey, nowMs) {
      failures.bump(clientKey, failureLimit, nowMs);
      prune(unknown, maxKeys, (expiresAt) => expiresAt <= nowMs);
      unknown.set(tokenKey, nowMs + negativeTtlMs);
    },
    isKnownBad(tokenKey, nowMs) {
      const expiresAt = unknown.get(tokenKey);
      if (expiresAt === undefined) return false;
      if (expiresAt > nowMs) return true;
      unknown.delete(tokenKey);
      return false;
    },
  };
}

/** Client identity for the failure budget: first `x-forwarded-for` hop, else `x-real-ip`. */
export function clientKeyOf(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

export type TokenAuth = { ok: true; userId: UUID } | { ok: false; reason: 'rate_limited'; retryAfterSec: number } | { ok: false; reason: 'unknown' };

const UNKNOWN: TokenAuth = { ok: false, reason: 'unknown' };

const limited = (d: RateDecision): TokenAuth => ({ ok: false, reason: 'rate_limited', retryAfterSec: d.retryAfterSec });

export interface TokenAuthInput {
  tokenHash: string;
  clientKey: string;
  nowMs: number;
}

/** Applies the checks in the order documented above and resolves the token's owner. */
export async function authorizeToken(limiter: RateLimiter, resolve: (tokenHash: string) => Promise<UUID | null>, input: TokenAuthInput): Promise<TokenAuth> {
  const tokenKey = input.tokenHash.slice(0, 24);
  const own = limiter.hitToken(tokenKey, input.nowMs);
  if (!own.allowed) return limited(own);
  if (limiter.isKnownBad(tokenKey, input.nowMs)) return UNKNOWN;
  const client = limiter.checkClient(input.clientKey, input.nowMs);
  if (!client.allowed) return limited(client);
  const userId = await resolve(input.tokenHash);
  if (!userId) {
    limiter.recordFailure(input.clientKey, tokenKey, input.nowMs);
    return UNKNOWN;
  }
  const global = limiter.hitGlobal(input.nowMs);
  if (!global.allowed) return limited(global);
  return { ok: true, userId };
}
