/**
 * Token accounting for one Claude call (claude-api skill, refusal fallbacks):
 * `usage.iterations` is the per-attempt source of truth; the top-level `usage`
 * covers only the attempt that produced the returned message. A request that
 * was declined and then served by a fallback model is billed for both attempts.
 */

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface IterationUsageLike extends TokenCounts {
  type: string;
}

export interface UsageLike extends TokenCounts {
  iterations?: readonly IterationUsageLike[] | null;
}

export interface BilledTokens {
  inputTokens: number;
  outputTokens: number;
  fallbackUsed: boolean;
}

/** Sampling attempts that count for billing (compaction / advisor entries are excluded). */
const ATTEMPT_TYPES: ReadonlySet<string> = new Set(['message', 'fallback_message']);

const inputOf = (u: TokenCounts): number => u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

/** Input (incl. cache writes/reads) and output tokens over every attempt. */
export function billedTokens(usage: UsageLike): BilledTokens {
  const attempts = (usage.iterations ?? []).filter((it) => ATTEMPT_TYPES.has(it.type));
  const fallbackUsed = attempts.some((it) => it.type === 'fallback_message');
  if (attempts.length === 0) {
    return { inputTokens: inputOf(usage), outputTokens: usage.output_tokens, fallbackUsed };
  }
  return {
    inputTokens: attempts.reduce((sum, it) => sum + inputOf(it), 0),
    outputTokens: attempts.reduce((sum, it) => sum + it.output_tokens, 0),
    fallbackUsed,
  };
}
