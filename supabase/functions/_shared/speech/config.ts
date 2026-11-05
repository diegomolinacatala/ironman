/**
 * Environment of the `speech` function (pure: the entry point passes `Deno.env.get`).
 * - Worker: AI_WORKER_URL + AI_WORKER_SECRET (≥ 32 chars, same rule as the chat provider); else null → 503.
 * - SPEECH_USER_DAILY_LIMIT (default 300 calls / user / 24 h).
 * - SPEECH_PREMIUM_DAILY_CHARS (default 2500 characters / UTC day across all users for Aura-2: about
 *   6.8k of the 10k free neurons, leaving room for the LLM, which uses ≤ 1.5k a day today).
 * Invalid numbers fall back to the defaults.
 */
import { MIN_WORKER_SECRET_LENGTH } from '../ai/provider.ts';
import type { EnvReader } from '../secrets.ts';
import type { SpeechLimits } from './ports.ts';

export const DEFAULT_SPEECH_USER_DAILY_LIMIT = 300;
export const DEFAULT_SPEECH_PREMIUM_DAILY_CHARS = 2500;
/** Far below int4: the values go to `svc_reserve_speech(… int, int)`. */
const MAX_LIMIT_VALUE = 1_000_000_000;

export interface SpeechWorkerConfig {
  url: string;
  secret: string;
}

const value = (env: EnvReader, name: string): string => (env(name) ?? '').trim();

function nonNegativeInt(env: EnvReader, name: string, fallback: number): number {
  const raw = value(env, name);
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= MAX_LIMIT_VALUE ? n : fallback;
}

export function speechLimits(env: EnvReader): SpeechLimits {
  return {
    userDailyLimit: nonNegativeInt(env, 'SPEECH_USER_DAILY_LIMIT', DEFAULT_SPEECH_USER_DAILY_LIMIT),
    premiumDailyChars: nonNegativeInt(env, 'SPEECH_PREMIUM_DAILY_CHARS', DEFAULT_SPEECH_PREMIUM_DAILY_CHARS),
  };
}

export function speechWorkerConfig(env: EnvReader): SpeechWorkerConfig | null {
  const url = value(env, 'AI_WORKER_URL');
  const secret = value(env, 'AI_WORKER_SECRET');
  return url && secret.length >= MIN_WORKER_SECRET_LENGTH ? { url, secret } : null;
}
