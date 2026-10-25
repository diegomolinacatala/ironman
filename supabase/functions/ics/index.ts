/**
 * Calendar feed: GET /functions/v1/ics/<secret>.ics (verify_jwt = false).
 * Subscribe with webcal:// in Apple Calendar / Google Calendar.
 */
import { handleIcsHttp } from '../_shared/ics/http.ts';
import { createRateLimiter } from '../_shared/mcp/token-gate.ts';
import { resolveToken } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';

const { db, logger } = edgeContext('ics', (name) => Deno.env.get(name));
const reader = db ? createPlanningStore(db, systemNow) : null;
const rateLimiter = createRateLimiter({ limit: 60, windowMs: 60_000, globalLimit: 600 });

Deno.serve((req: Request) => {
  if (!db || !reader) return misconfigured();
  return handleIcsHttp(req, {
    resolveUserId: (hash) => resolveToken(db, hash, 'ics'),
    reader,
    rateLimiter,
    now: systemNow,
    logger,
  });
});
