/**
 * Background part of the coach: context → Claude (structured output) →
 * validated changes → plan_proposals (source 'ai_coach') → memory lines in
 * coach_notes + logged imprevisto → coach_jobs done (with `extras`).
 * Any failure (including the overall deadline) ends the job with status
 * 'error' and a Spanish message, so the app can fall back to the rules engine.
 */
import { addDays } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { checkChanges, PLAN_WINDOW_DAYS, withSource } from '../planning/changes.ts';
import { buildPlanningContext, NotFoundError } from '../planning/context.ts';
import type { PlanningContext } from '../planning/context.ts';
import type { PlanningReader } from '../planning/store.ts';
import type { CoachRequest, PlanChange, ProposalKind, UUID } from '../types.ts';
import { COACH_DEADLINE_MS, startDeadline, timeoutError, withDeadline } from './deadline.ts';
import { applyCoachExtras } from './extras.ts';
import { buildCoachMessages } from './messages.ts';
import type { FriendWeek } from './messages.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput, toPlanChanges } from './output.ts';
import { CoachAiError } from './ports.ts';
import type { ClaudePort, ClaudeResponse, CoachStore } from './ports.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';

export const COACH_MAX_TOKENS = 16000;

export interface CoachJob {
  jobId: UUID;
  userId: UUID;
  request: CoachRequest;
}

export interface CoachJobDeps {
  reader: PlanningReader;
  store: CoachStore;
  claude: ClaudePort;
  now: () => Date;
  logger: Logger;
  /** Overall budget of the job (defaults to COACH_DEADLINE_MS). */
  deadlineMs?: number;
}

const KIND: Record<CoachRequest['mode'], ProposalKind> = { plan_week: 'generate_week', replan: 'replan', chat: 'chat' };

function friendWeeks(deps: CoachJobDeps, job: CoachJob, context: PlanningContext): Promise<FriendWeek[]> {
  const wanted = context.friends.filter((f) => job.request.friendIds?.includes(f.friendId));
  return Promise.all(
    wanted.map(async (f) => ({
      friendId: f.friendId,
      name: f.name,
      items: await deps.reader.getFriendWeek(job.userId, f.friendId, context.weekStart, addDays(context.weekStart, 13)),
    })),
  );
}

function checkStop(response: ClaudeResponse): void {
  if (response.stopReason === 'refusal') {
    throw new CoachAiError('refusal', 'El coach con IA no ha podido responder a esta petición. Reformúlala o usa el plan automático.');
  }
  if (response.stopReason === 'max_tokens') {
    throw new CoachAiError('max_tokens', 'La respuesta del coach se ha cortado por ser demasiado larga. Prueba con una petición más concreta.');
  }
}

async function recordUsage(deps: CoachJobDeps, job: CoachJob, response: ClaudeResponse): Promise<void> {
  try {
    await deps.store.recordUsage(job.userId, {
      functionName: 'coach',
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });
  } catch (error) {
    deps.logger.warn('coach usage not recorded', errorInfo(error));
  }
}

interface ValidatedChanges {
  changes: PlanChange[];
  dropped: number;
}

async function validateAgainstPlan(deps: CoachJobDeps, job: CoachJob, context: PlanningContext, raw: Parameters<typeof toPlanChanges>[0]): Promise<ValidatedChanges> {
  const converted = toPlanChanges(raw);
  const workouts = await deps.reader.listWorkouts(job.userId, context.weekStart, addDays(context.weekStart, PLAN_WINDOW_DAYS - 1));
  const checked = checkChanges(converted.changes, { weekStart: context.weekStart, today: context.today, workouts });
  const dropped = converted.rejected.length + checked.issues.length;
  if (dropped > 0) {
    deps.logger.info('coach changes dropped', { jobId: job.jobId, dropped, issues: [...converted.rejected, ...checked.issues].slice(0, 10) });
  }
  return { changes: withSource(checked.valid, 'ai_coach'), dropped };
}

function finalReply(reply: string, dropped: number, hasProposal: boolean): string {
  const trimmed = reply.trim().slice(0, 4000);
  const notes = [
    dropped > 0 ? `He descartado ${dropped} cambio${dropped === 1 ? '' : 's'} que no encajaba${dropped === 1 ? '' : 'n'} con tu calendario.` : '',
    hasProposal ? 'Revisa la propuesta y acepta los cambios que te convenzan.' : '',
  ].filter(Boolean);
  return notes.length ? `${trimmed}\n\n${notes.join(' ')}` : trimmed;
}

export function userFacingError(error: unknown): string {
  if (error instanceof CoachAiError) return error.message;
  if (error instanceof NotFoundError) return error.message;
  return 'El coach con IA no está disponible ahora mismo. Te propongo el plan automático mientras tanto.';
}

interface Generated {
  context: PlanningContext;
  response: ClaudeResponse;
}

/** Context + Claude call, both bounded by the job deadline. */
async function generate(deps: CoachJobDeps, job: CoachJob, signal: AbortSignal): Promise<Generated> {
  const context = await withDeadline(
    buildPlanningContext(deps.reader, { userId: job.userId, weekStart: job.request.weekStart, now: deps.now(), detail: 'detailed', includeNextWeek: true }),
    signal,
  );
  const lifeEvent = job.request.lifeEventId ? context.lifeEvents.find((e) => e.id === job.request.lifeEventId) ?? null : null;
  const friends = await withDeadline(friendWeeks(deps, job, context), signal);
  const messages = buildCoachMessages(job.request, context, { lifeEvent, friends });
  const response = await withDeadline(
    deps.claude.generate({
      userId: job.userId,
      system: COACH_SYSTEM_PROMPT,
      messages,
      effort: job.request.mode === 'chat' ? 'low' : 'medium',
      schema: COACH_OUTPUT_JSON_SCHEMA,
      maxTokens: COACH_MAX_TOKENS,
      signal,
    }),
    signal,
  );
  return { context, response };
}

async function markFailed(deps: CoachJobDeps, job: CoachJob, log: Logger, error: unknown): Promise<void> {
  log.error('coach job failed', errorInfo(error));
  try {
    const marked = await deps.store.failJob(job.userId, job.jobId, userFacingError(error));
    if (!marked) log.warn('coach job was no longer running');
  } catch (inner) {
    log.error('coach job could not be marked as failed', errorInfo(inner));
  }
}

/** Runs one job end to end. Never throws: failures are written to the job row. */
export async function runCoachJob(deps: CoachJobDeps, job: CoachJob): Promise<void> {
  const log = deps.logger.child({ jobId: job.jobId, mode: job.request.mode });
  const deadline = startDeadline(deps.deadlineMs ?? COACH_DEADLINE_MS);
  const started = Date.now();
  try {
    const { context, response } = await generate(deps, job, deadline.signal);
    await recordUsage(deps, job, response);
    if (response.fallbackUsed) log.info('coach served by fallback model', { model: response.model });
    checkStop(response);
    const output = parseCoachOutput(response.text);
    if (!output) throw new CoachAiError('bad_output', 'La respuesta del coach no tenía el formato esperado. Inténtalo de nuevo.');
    const validated = await withDeadline(validateAgainstPlan(deps, job, context, output.changes), deadline.signal);
    const changes = validated.changes;
    const dropped = validated.dropped + output.malformedChanges;
    // Past the deadline the app has already fallen back: do not add a competing proposal.
    if (deadline.signal.aborted) throw timeoutError();
    const proposalId =
      changes.length > 0
        ? await deps.store.insertProposal(job.userId, {
            kind: KIND[job.request.mode],
            source: 'ai_coach',
            weekStart: context.weekStart,
            summary: (output.summary || output.reply).slice(0, 1000),
            changes,
            model: response.model,
          })
        : null;
    const extras = await withDeadline(applyCoachExtras(deps, job.userId, job.request, output, context, log), deadline.signal);
    const finished = await deps.store.finishJob(job.userId, job.jobId, {
      reply: finalReply(output.reply, dropped, proposalId !== null),
      proposalId,
      extras,
    });
    if (!finished) log.warn('coach job was no longer running when it finished', { proposalId });
    log.info('coach job done', { ms: Date.now() - started, changes: changes.length, dropped, memory: extras.memory.length, lifeEvent: extras.lifeEventId !== null });
  } catch (error) {
    await markFailed(deps, job, log, error);
  } finally {
    deadline.dispose();
  }
}
