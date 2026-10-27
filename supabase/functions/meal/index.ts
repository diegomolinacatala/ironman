/**
 * Meal photo analysis: POST { date, time, imageBase64?, text? } with the user JWT → 200 MealAnalysis.
 * verify_jwt = false in config.toml; the JWT is verified in code (userIdFromJwt), like `garmin`.
 * Vision model (Workers AI or Claude; effort low, structured output); stores nothing but the ai_usage row.
 */
import { bearerToken } from '../_shared/http.ts';
import { handleMealHttp } from '../_shared/meal/http.ts';
import { createAiPort } from '../_shared/platform/ai-provider.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createAiUsageStore } from '../_shared/platform/service-stores.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('meal', env);
// Workers AI vision model (AI_VISION_MODEL) when the worker is configured; else Claude; else null (503).
const claude = createAiPort(env, 'vision', logger);
const reader = db ? createPlanningStore(db, systemNow) : null;
const usage = db ? createAiUsageStore(db) : null;

Deno.serve((req: Request) => {
  if (!db || !reader || !usage) return misconfigured();
  return handleMealHttp(req, {
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    reader,
    usage,
    claude,
    now: systemNow,
    logger,
  });
});
