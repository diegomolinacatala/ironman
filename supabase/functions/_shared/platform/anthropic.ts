/**
 * Claude adapter for coach, briefing and meal (claude-api skill rules):
 * - model claude-opus-5-5, adaptive thinking (no `thinking`, no sampling params, no budget);
 * - structured outputs via `output_config.format` (json_schema) + `effort`;
 * - streaming + finalMessage(), SDK timeout 120 s, maxRetries 1; the job's
 *   AbortSignal bounds the whole stream (the SDK timeout only covers the
 *   wait for response headers, not the streamed body);
 * - server-side refusal fallback (`fallbacks: 'default'`, beta server-side-fallback-2026-07-01);
 * - prompt caching on the static system prompt block;
 * - usage summed over `usage.iterations` (declined attempt + fallback);
 * - user content may carry base64 image blocks (meal photos, vision).
 */
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { isAbortLike, timeoutError } from '../coach/deadline.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { ClaudeMessage, ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { billedTokens } from '../coach/usage.ts';

export const COACH_MODEL = 'claude-opus-5-5';

/** Typed SDK errors → Spanish CoachAiError, most specific first. */
export function mapAnthropicError(error: unknown): CoachAiError {
  if (error instanceof CoachAiError) return error;
  // User abort (our job deadline) extends APIError: check it before the generic classes.
  if (error instanceof Anthropic.APIUserAbortError || isAbortLike(error)) return timeoutError();
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new CoachAiError('timeout', 'El coach con IA ha tardado demasiado en responder. Inténtalo de nuevo.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new CoachAiError('network', 'No hemos podido conectar con el coach con IA. Revisa tu conexión e inténtalo de nuevo.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new CoachAiError('rate_limited', 'El coach con IA está saturado ahora mismo. Inténtalo en unos minutos.');
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new CoachAiError('auth', 'El coach con IA no está bien configurado en el servidor.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new CoachAiError('api', 'El coach con IA no ha podido procesar la petición. Inténtalo con un mensaje más corto.');
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new CoachAiError('overloaded', 'El coach con IA no está disponible ahora mismo. Inténtalo en unos minutos.');
  }
  if (error instanceof Anthropic.APIError) {
    return new CoachAiError('api', 'El coach con IA ha devuelto un error. Inténtalo de nuevo.');
  }
  return new CoachAiError('api', 'Error inesperado del coach con IA.');
}

/** Port message → Messages API param (string content passes through; images become base64 sources). */
export function toApiMessage(m: ClaudeMessage): Anthropic.Beta.BetaMessageParam {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const content: Anthropic.Beta.BetaContentBlockParam[] = m.content.map((b) =>
    b.type === 'text'
      ? { type: 'text', text: b.text }
      : { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.base64 } },
  );
  return { role: m.role, content };
}

export function createClaudePort(apiKey: string): ClaudePort {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  return {
    async generate(req: ClaudeRequest): Promise<ClaudeResponse> {
      try {
        const stream = client.beta.messages.stream(
          {
            model: COACH_MODEL,
            max_tokens: req.maxTokens,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages: req.messages.map(toApiMessage),
            output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
          },
          { signal: req.signal ?? null },
        );
        const message = await stream.finalMessage();
        const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
        const tokens = billedTokens(message.usage);
        return {
          text,
          stopReason: message.stop_reason,
          model: message.model,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          fallbackUsed: tokens.fallbackUsed,
        };
      } catch (error) {
        throw mapAnthropicError(error);
      }
    },
  };
}
