/**
 * Which AI runs coach, briefing and meal (docs/V2.md, "the app must cost nothing"):
 * Cloudflare Workers AI through our worker when AI_WORKER_URL + AI_WORKER_SECRET (≥ 32 chars)
 * are set (free tier), else Claude when ANTHROPIC_API_KEY is set AND AI_ALLOW_PAID=1 (a paid path is
 * never taken by accident, e.g. after the worker secrets go missing), else none (503 ai_unavailable).
 * Pure: the entry points build the port from this choice.
 */
import type { EnvReader } from '../secrets.ts';

/**
 * Defaults chosen with live tests on the Workers Free plan. 2026-11-26 (Nemotron 3, the previous
 * default, was deprecated on 2026-11-20 and every coach call failed): Qwen 3.8 27B answers the real
 * coach prompt in ~7 s with valid JSON and the right figures (the worker keeps its thinking off: on,
 * it took 95-120 s); the worker falls back to gpt-oss-120b (~10 s) if a model is retired again.
 * 2026-10-27: Llama 4 Scout reads meal photos best (~3 s, right meal slot) — Gemma 4 was slower and less exact.
 */
export const DEFAULT_WORKERS_MODEL = '@cf/qwen/qwen3.8-27b';
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
  return apiKey && value(env, 'AI_ALLOW_PAID') === '1' ? { kind: 'claude', apiKey } : { kind: 'none' };
}
