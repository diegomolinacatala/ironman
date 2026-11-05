/**
 * Natural text-to-speech for the coach and the morning briefing: POST { text, voice? } with the
 * user JWT → 200 { audio (base64), mime, model, tier }. verify_jwt = false in config.toml; the JWT
 * is verified in code (userIdFromJwt), like `briefing`. Consent + svc_reserve_speech (per-user 24 h
 * limit, global premium budget per UTC day) before calling our Cloudflare worker (POST /v1/speech).
 * Without AI_WORKER_URL + AI_WORKER_SECRET it answers 503 ai_unavailable (the app uses the iPhone voice).
 */
import { bearerToken } from '../_shared/http.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { edgeContext, misconfigured } from '../_shared/platform/runtime.ts';
import { createSpeechBudgetStore } from '../_shared/platform/speech-store.ts';
import { createWorkersSpeechPort } from '../_shared/platform/workers-speech.ts';
import { speechLimits, speechWorkerConfig } from '../_shared/speech/config.ts';
import { handleSpeechHttp } from '../_shared/speech/http.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('speech', env);
const budget = db ? createSpeechBudgetStore(db) : null;
const worker = speechWorkerConfig(env);
const speech = worker ? createWorkersSpeechPort({ ...worker, fetch: (input, init) => fetch(input, init) }) : null;
const limits = speechLimits(env);
if (!worker) logger.warn('speech worker not configured (AI_WORKER_URL / AI_WORKER_SECRET)');

Deno.serve((req: Request) => {
  if (!db || !budget) return misconfigured();
  return handleSpeechHttp(req, {
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    budget,
    speech,
    limits,
    logger,
  });
});
