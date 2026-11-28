/**
 * Post-workout analysis ("Analizar"): POST { workoutId, date, refresh? } with the user JWT → 200 WorkoutAnalysis.
 * verify_jwt = false in config.toml; the JWT is verified in code (userIdFromJwt), like `briefing`.
 * Returns the stored row when present; otherwise asks the AI (Workers AI or Claude; effort low,
 * structured output) and upserts `workout_analyses`.
 */
import { handleAnalysisHttp } from '../_shared/analysis/http.ts';
import { bearerToken } from '../_shared/http.ts';
import { createAiPort } from '../_shared/platform/ai-provider.ts';
import { createAnalysisStore } from '../_shared/platform/analysis-store.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createAiUsageStore } from '../_shared/platform/service-stores.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('analysis', env);
// Workers AI (free) when AI_WORKER_URL + AI_WORKER_SECRET are set; else Claude; else null (503).
const claude = createAiPort(env, 'text', logger);
const reader = db ? createPlanningStore(db, systemNow) : null;
const analyses = db ? createAnalysisStore(db) : null;
const usage = db ? createAiUsageStore(db) : null;

Deno.serve((req: Request) => {
  if (!db || !reader || !analyses || !usage) return misconfigured();
  return handleAnalysisHttp(req, {
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    reader,
    analyses,
    usage,
    claude,
    now: systemNow,
    logger,
  });
});
