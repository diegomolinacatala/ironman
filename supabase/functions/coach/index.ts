/**
 * AI coach: POST CoachRequest (user JWT, verify_jwt = true) → 202 { jobId };
 * the AI call (Workers AI or Claude) runs in the background (bounded by
 * COACH_DEADLINE_MS) and writes coach_jobs + plan_proposals.
 */
import { TIMEOUT_MESSAGE } from '../_shared/coach/deadline.ts';
import { handleCoachHttp } from '../_shared/coach/http.ts';
import { runCoachJob } from '../_shared/coach/job.ts';
import { bearerToken } from '../_shared/http.ts';
import { createAiPort } from '../_shared/platform/ai-provider.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, runInBackground, systemNow } from '../_shared/platform/runtime.ts';
import { createCoachStore } from '../_shared/platform/service-stores.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('coach', env);
// Workers AI (free) when AI_WORKER_URL + AI_WORKER_SECRET are set; else Claude; else null (503).
const claude = createAiPort(env, 'text', logger);
const reader = db ? createPlanningStore(db, systemNow) : null;
const coachStore = db ? createCoachStore(db) : null;

/** Jobs still running in this isolate (jobId → userId). */
const activeJobs = new Map<string, string>();

// If the isolate is about to be shut down (wall-clock limit), close the jobs so the app falls back quickly.
globalThis.addEventListener('beforeunload', () => {
  for (const [jobId, userId] of activeJobs) {
    coachStore?.failJob(userId, jobId, TIMEOUT_MESSAGE).catch(() => undefined);
  }
});

Deno.serve((req: Request) => {
  if (!db || !reader || !coachStore) return misconfigured();
  return handleCoachHttp(req, {
    aiConfigured: claude !== null,
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    store: coachStore,
    startJob: (job) => {
      if (!claude) return;
      activeJobs.set(job.jobId, job.userId);
      const task = runCoachJob({ reader, store: coachStore, claude, now: systemNow, logger }, job).finally(() => activeJobs.delete(job.jobId));
      runInBackground(task, logger);
    },
    logger,
  });
});
