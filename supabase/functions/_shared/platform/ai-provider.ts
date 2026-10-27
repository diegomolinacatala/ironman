/**
 * Builds the AI port of an entry point: Workers AI (free, via the `ironman-ai` worker) when
 * AI_WORKER_URL + AI_WORKER_SECRET are set, else Claude with ANTHROPIC_API_KEY, else null
 * (the functions then answer 503 ai_unavailable and the app uses its local engines).
 */
import { chooseAiProvider } from '../ai/provider.ts';
import type { AiPurpose } from '../ai/provider.ts';
import type { ClaudePort } from '../coach/ports.ts';
import type { Logger } from '../log.ts';
import type { EnvReader } from '../secrets.ts';
import { createClaudePort } from './anthropic.ts';
import { createWorkersAiPort } from './workers-ai.ts';

export function createAiPort(env: EnvReader, purpose: AiPurpose, logger: Logger): ClaudePort | null {
  const choice = chooseAiProvider(env, purpose);
  if (env('AI_WORKER_URL') && choice.kind !== 'workers') logger.warn('AI_WORKER_SECRET missing or shorter than 32 characters: Workers AI disabled');
  logger.info('ai provider', { provider: choice.kind, ...(choice.kind === 'workers' ? { model: choice.model } : {}) });
  if (choice.kind === 'workers') {
    return createWorkersAiPort({ url: choice.url, secret: choice.secret, model: choice.model, fetch: (input, init) => fetch(input, init) });
  }
  return choice.kind === 'claude' ? createClaudePort(choice.apiKey) : null;
}
