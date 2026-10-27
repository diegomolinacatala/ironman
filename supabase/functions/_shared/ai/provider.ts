/**
 * Which AI runs coach, briefing and meal (docs/V2.md, "the app must cost nothing"):
 * Cloudflare Workers AI through our worker when AI_WORKER_URL + AI_WORKER_SECRET (≥ 32 chars)
 * are set (free tier), else Claude when ANTHROPIC_API_KEY is set, else none (503 ai_unavailable).
 * Pure: the entry points build the port from this choice.
 */
import type { EnvReader } from '../secrets.ts';

/**
 * Defaults chosen with live tests on the Workers Free plan (2026-10-27; GLM-5.3 and DeepSeek V4.1
 * are paid-plan only): Nemotron 3 writes the best Spanish JSON fast (~3 s, also used by Tasks);
 * Llama 4 Scout reads meal photos best (~3 s, right meal slot) — Gemma 4 was slower and less exact.
 */
export const DEFAULT_WORKERS_MODEL = '@cf/nvidia/nemotron-3-120b-a12b';
export const DEFAULT_WORKERS_VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
/** The worker refuses shorter shared secrets (misconfigured), so they never select it here. */
export const MIN_WORKER_SECRET_LENGTH = 32;

/** 'text' = coach and briefing (AI_MODEL); 'vision' = meal photos (AI_VISION_MODEL). */
export type AiPurpose = 'text' | 'vision';

export type AiProviderChoice =
  | { kind: 'workers'; url: string; secret: string; model: string }
  | { kind: 'claude'; apiKey: string }
  | { kind: 'none' };

const value = (env: EnvReader, name: string): string => (env(name) ?? '').trim();

export function chooseAiProvider(env: EnvReader, purpose: AiPurpose): AiProviderChoice {
  const url = value(env, 'AI_WORKER_URL');
  const secret = value(env, 'AI_WORKER_SECRET');
  if (url && secret.length >= MIN_WORKER_SECRET_LENGTH) {
    const model =
      purpose === 'vision'
        ? value(env, 'AI_VISION_MODEL') || DEFAULT_WORKERS_VISION_MODEL
        : value(env, 'AI_MODEL') || DEFAULT_WORKERS_MODEL;
    return { kind: 'workers', url, secret, model };
  }
  const apiKey = value(env, 'ANTHROPIC_API_KEY');
  return apiKey ? { kind: 'claude', apiKey } : { kind: 'none' };
}
