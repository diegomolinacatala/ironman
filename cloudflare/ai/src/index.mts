/** Entry point of the `ironman-ai` worker (see wrangler.toml). */
import { handleRequest } from './http.mts';
import type { Env } from './types.mts';

const log = (level: 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.warn(line);
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      ai: env.AI,
      ipLimiter: env.IP_LIMITER ?? null,
      chatLimiter: env.CHAT_LIMITER ?? null,
      secret: env.AI_SHARED_SECRET,
      log,
    });
  },
};
