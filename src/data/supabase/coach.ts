/**
 * Coach for the Supabase backend. With the AI OFF (`env.aiCoachEnabled` false,
 * EXPO_PUBLIC_AI_COACH=0) it is simply the local rules engine: no edge function, no
 * `coach_jobs`, nothing leaves the device for the AI provider.
 *
 * With it ON: `coach` edge function POST (the request, incl. `channel`) →
 * 202 { jobId } → poll the `coach_jobs` row every 2 s (max 130 s) → load the
 * proposal, the saved memory lines and the logged life event (`extras`).
 * Falls back to the local rules engine (with a notice) when AI is unavailable
 * or anything fails.
 */
import type { CoachRequest, CoachResponse, ISODate, LifeEvent, UUID } from '@/domain/types';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { runRulesCoach, type RulesCoachRepo } from '../demo/rulesCoach';
import { run, type SupabaseCtx } from './base';
import { functionErrorInfo, isNetworkError } from './errors';
import { rowToLifeEvent } from './mappers';
import { EMPTY_COACH_EXTRAS, parseCoachExtras, type CoachExtras } from './mappersAi';
import { asString, isRecord, pick } from './narrow';
import type { CoachJobRow, LifeEventRow } from './rows';

export const COACH_POLL_INTERVAL_MS = 2_000;
/** Server job deadline is 110 s (Edge wall clock 150 s); stop polling shortly after. */
export const COACH_MAX_WAIT_MS = 130_000;

export const COACH_NOTICES = {
  unavailable: 'El coach IA no está activado todavía, así que te respondo con el motor de reglas.',
  rateLimited: 'Has llegado al límite diario del coach IA; hoy te respondo con el motor de reglas.',
  failed: 'El coach IA no ha podido responder; te respondo con el motor de reglas.',
  timeout: 'El coach IA está tardando demasiado; mientras, aquí tienes la propuesta del motor de reglas.',
  consentRequired:
    'Para usar el coach IA primero tienes que darnos tu permiso para que la IA lea tus datos. Mientras, te respondo con el motor de reglas.',
} as const;

export interface CoachDeps {
  ctx: SupabaseCtx;
  repo: RulesCoachRepo & Pick<Repository, 'getProposal'>;
  today: () => ISODate;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

type StartResult = { jobId: UUID } | { notice: string };

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function parseJobId(data: unknown): UUID | null {
  if (typeof data === 'string') {
    try {
      return parseJobId(JSON.parse(data) as unknown);
    } catch {
      return null;
    }
  }
  return isRecord(data) ? asString(pick(data, 'jobId', 'job_id')) : null;
}

async function startJob(ctx: SupabaseCtx, request: CoachRequest): Promise<StartResult> {
  let response: { data: unknown; error: unknown };
  try {
    response = await ctx.client.functions.invoke('coach', { body: request });
  } catch (error) {
    logger.warn('coach invoke threw', error);
    return { notice: COACH_NOTICES.failed };
  }
  if (response.error) {
    const info = await functionErrorInfo(response.error);
    logger.warn('coach invoke failed', { status: info.status, error: info.errorCode });
    if (info.status === 401) throw new RepositoryError('not_authenticated', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
    // 403 { error: 'consent_required' }: no AI consent stored (profiles.ai_consent_at is null).
    if (info.errorCode === 'consent_required') return { notice: COACH_NOTICES.consentRequired };
    if (info.status === 503 || info.errorCode === 'ai_unavailable') return { notice: COACH_NOTICES.unavailable };
    if (info.status === 429) return { notice: COACH_NOTICES.rateLimited };
    return { notice: COACH_NOTICES.failed };
  }
  const jobId = parseJobId(response.data);
  return jobId ? { jobId } : { notice: COACH_NOTICES.failed };
}

async function readJob(ctx: SupabaseCtx, jobId: UUID): Promise<CoachJobRow | null> {
  try {
    return await run<CoachJobRow | null>(
      'coachJob',
      ctx.client.from('coach_jobs').select('id,user_id,status,reply,proposal_id,engine,error').eq('id', jobId).maybeSingle(),
    );
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'not_authenticated') throw error;
    // Transient (network blip): keep polling.
    logger.warn('coach job poll failed', isNetworkError(error) ? 'network' : error);
    return null;
  }
}

async function pollJob(deps: CoachDeps, jobId: UUID): Promise<CoachJobRow | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const interval = deps.pollIntervalMs ?? COACH_POLL_INTERVAL_MS;
  const attempts = Math.ceil((deps.maxWaitMs ?? COACH_MAX_WAIT_MS) / interval);
  for (let i = 0; i < attempts; i += 1) {
    await sleep(interval);
    const job = await readJob(deps.ctx, jobId);
    if (job && job.status !== 'running') return job;
  }
  return null;
}

/**
 * `coach_jobs.extras` (v2) is read once the job is done, apart from the poll:
 * a failure here only loses the memory chips, never the coach answer.
 */
async function readExtras(ctx: SupabaseCtx, jobId: UUID): Promise<CoachExtras> {
  try {
    const row = await run<{ extras?: unknown } | null>(
      'coachJobExtras',
      ctx.client.from('coach_jobs').select('extras').eq('id', jobId).maybeSingle(),
    );
    return parseCoachExtras(row?.extras);
  } catch (error) {
    logger.warn('coach job extras unavailable', error instanceof RepositoryError ? error.code : error);
    return EMPTY_COACH_EXTRAS;
  }
}

async function readLifeEvent(ctx: SupabaseCtx, id: UUID): Promise<LifeEvent | null> {
  try {
    const row = await run<LifeEventRow | null>('coachLifeEvent', ctx.client.from('life_events').select('*').eq('id', id).maybeSingle());
    return row ? rowToLifeEvent(row) : null;
  } catch (error) {
    logger.warn('coach life event unavailable', error instanceof RepositoryError ? error.code : error);
    return null;
  }
}

async function jobToResponse(deps: CoachDeps, job: CoachJobRow): Promise<CoachResponse> {
  const [proposal, extras] = await Promise.all([
    job.proposal_id ? deps.repo.getProposal(job.proposal_id) : Promise.resolve(null),
    readExtras(deps.ctx, job.id),
  ]);
  const lifeEvent = extras.lifeEventId ? await readLifeEvent(deps.ctx, extras.lifeEventId) : null;
  const reply = job.reply?.trim() || proposal?.summary || 'Listo. Revisa la propuesta.';
  return { reply, proposal, engine: job.engine === 'rules' ? 'rules' : 'ai', memory: extras.memory, lifeEvent };
}

export function createCoachRequester(deps: CoachDeps): (request: CoachRequest) => Promise<CoachResponse> {
  const fallback = (request: CoachRequest, notice: string): Promise<CoachResponse> =>
    runRulesCoach(deps.repo, request, { today: deps.today(), notice });

  return async (request) => {
    // AI off (EXPO_PUBLIC_AI_COACH=0): the rules engine IS the coach, so no notice.
    if (!env.aiCoachEnabled) return runRulesCoach(deps.repo, request, { today: deps.today() });
    const started = await startJob(deps.ctx, request);
    if ('notice' in started) return fallback(request, started.notice);
    const job = await pollJob(deps, started.jobId);
    if (!job) return fallback(request, COACH_NOTICES.timeout);
    if (job.status === 'error') {
      logger.warn('coach job error', job.error);
      return fallback(request, COACH_NOTICES.failed);
    }
    return jobToResponse(deps, job);
  };
}
