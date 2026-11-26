/**
 * Background part of the coach: context (short workout ids) → model
 * (structured output) → ids mapped back and validated changes (with each
 * session's steps and prescription, defaults filled server-side) →
 * plan_proposals (source 'ai_coach') → memory lines in coach_notes + logged
 * imprevisto + suggested quedada + suggested general plan (week plans) →
 * coach_jobs done (with `extras`).
 *
 * Reliability: chat uses the concise context (cheaper) and thinks harder only
 * when the athlete asks to change the plan; each model call has its own
 * timeout; ONE repair re-prompt runs (time allowing) when the answer is cut,
 * not valid JSON, every change was dropped, or a requested change is missing;
 * the reply never claims changes that are not in the proposal.
 * Any failure (including the overall deadline) ends the job with status
 * 'error' and a Spanish message, so the app can say why and fall back to the
 * rules engine.
 */
import { addDays, startOfWeek } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { checkChanges, PLAN_WINDOW_DAYS, withSource } from '../planning/changes.ts';
import { buildPlanningContext, NotFoundError } from '../planning/context.ts';
import type { PlanningContext } from '../planning/context.ts';
import type { PlanningReader } from '../planning/store.ts';
import type { CoachJobExtras, CoachRequest, PlanChange, ProposalKind, UUID, Workout } from '../types.ts';
import { COACH_DEADLINE_MS, startDeadline, timeoutError, withDeadline } from './deadline.ts';
import { withDefaultCoaching } from './defaults.ts';
import { applyCoachExtras } from './extras.ts';
import { claimsChanges, wantsPlanChange } from './intent.ts';
import { buildCoachMessages } from './messages.ts';
import type { FriendWeek } from './messages.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput, toPlanChanges } from './output.ts';
import type { CoachOutput, FlatChange } from './output.ts';
import { CoachAiError } from './ports.ts';
import type { ClaudeMessage, ClaudePort, ClaudeRequest, ClaudeResponse, CoachStore } from './ports.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';
import { idLegend, resolveWorkoutId, shortenUuids, shortIdsFor } from './short-ids.ts';
import type { ShortIds } from './short-ids.ts';
import { weatherForCoach } from '../weather/prompt.ts';
import { safeForecast } from '../weather/service.ts';
import type { WeatherReader } from '../weather/service.ts';

export const COACH_MAX_TOKENS = 16000;
/** Longest first model call: a hung worker must leave time for the repair. */
export const FIRST_CALL_MAX_MS = 80_000;
/** Time the repair re-prompt needs to be worth trying. */
export const REPAIR_MIN_MS = 30_000;
const CALL_MARGIN_MS = 2_000;
const PREVIOUS_ANSWER_MAX = 6000;

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
  /** The forecast of the athlete's city (null/absent: the coach gets no weather). */
  weather?: WeatherReader | null;
}

const KIND: Record<CoachRequest['mode'], ProposalKind> = { plan_week: 'generate_week', replan: 'replan', chat: 'chat' };

const CUT_MESSAGE = 'La respuesta del coach se ha cortado por ser demasiado larga. Prueba con una petición más concreta.';
const BAD_OUTPUT_MESSAGE = 'La respuesta del coach no tenía el formato esperado. Inténtalo de nuevo.';
const HOW_TO_ASK = 'Dímelo con el día y la sesión (por ejemplo, «mueve el rodaje del martes al jueves») y te lo propongo.';

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

export function userFacingError(error: unknown): string {
  if (error instanceof CoachAiError) return error.message;
  if (error instanceof NotFoundError) return error.message;
  return 'El coach con IA no está disponible ahora mismo. Te propongo el plan automático mientras tanto.';
}

// ---------------------------------------------------------------------------
// Preparation and model calls
// ---------------------------------------------------------------------------

export interface Prepared {
  context: PlanningContext;
  ids: ShortIds;
  messages: ClaudeMessage[];
  effort: ClaudeRequest['effort'];
  /** Chat message that asks to change the plan: changes are mandatory. */
  wantsChange: boolean;
  /** «Tu contexto» chat (`topic: 'context'`): no changes, no imprevisto, no quedada, no week plans. */
  contextOnly?: boolean;
  /** Planned + done workouts of the 14-day window (validation, loose id matching). */
  workouts: Workout[];
  /** Request mode (plan_week never adds on top of an imported week). */
  mode?: CoachRequest['mode'];
}

async function prepare(deps: CoachJobDeps, job: CoachJob, signal: AbortSignal): Promise<Prepared> {
  const chat = job.request.mode === 'chat';
  const context = await withDeadline(
    buildPlanningContext(deps.reader, {
      userId: job.userId,
      weekStart: job.request.weekStart,
      now: deps.now(),
      // Chat: ids, dates, sport, title, duration, intensity and busy times are enough (saves free neurons).
      detail: chat ? 'concise' : 'detailed',
      includeNextWeek: true,
    }),
    signal,
  );
  const lifeEvent = job.request.lifeEventId ? context.lifeEvents.find((e) => e.id === job.request.lifeEventId) ?? null : null;
  const [friends, workouts, forecast] = await withDeadline(
    Promise.all([
      friendWeeks(deps, job, context),
      deps.reader.listWorkouts(job.userId, context.weekStart, addDays(context.weekStart, PLAN_WINDOW_DAYS - 1)),
      // Best effort and bounded: the coach answers without the weather when it is not there.
      safeForecast(deps.weather, job.userId, deps.logger),
    ]),
    signal,
  );
  const ids = shortIdsFor(context);
  const contextOnly = chat && job.request.topic === 'context';
  const wantsChange = chat && !contextOnly && wantsPlanChange(job.request.message);
  const weather = forecast ? weatherForCoach(forecast, context.today) : null;
  return {
    context,
    ids,
    messages: buildCoachMessages(job.request, context, { lifeEvent, friends, ids, weather }),
    effort: chat && !wantsChange ? 'low' : 'medium',
    wantsChange,
    contextOnly,
    workouts,
    mode: job.request.mode,
  };
}

/** «Tu contexto»: the coach only listens and remembers — whatever else the model returned is dropped. */
export function contextOnlyOutput(output: CoachOutput): CoachOutput {
  return { ...output, changes: [], malformedChanges: 0, life_event: null, quedada: null, week_plans: null };
}

interface Clock {
  signal: AbortSignal;
  remaining: () => number;
}

async function callModel(deps: CoachJobDeps, job: CoachJob, clock: Clock, messages: ClaudeMessage[], effort: ClaudeRequest['effort'], capMs: number): Promise<ClaudeResponse> {
  const response = await withDeadline(
    deps.claude.generate({
      userId: job.userId,
      system: COACH_SYSTEM_PROMPT,
      messages,
      effort,
      schema: COACH_OUTPUT_JSON_SCHEMA,
      maxTokens: COACH_MAX_TOKENS,
      signal: clock.signal,
      timeoutMs: Math.max(1_000, Math.min(capMs, clock.remaining() - CALL_MARGIN_MS)),
    }),
    clock.signal,
  );
  await recordUsage(deps, job, response);
  if (response.fallbackUsed) deps.logger.info('coach served by fallback model', { model: response.model });
  return response;
}

// ---------------------------------------------------------------------------
// Validation (short ids → UUIDs, loose matching, plan checks, defaults)
// ---------------------------------------------------------------------------

export interface Validated {
  changes: PlanChange[];
  dropped: number;
  /** Why changes were dropped (Spanish, short ids instead of UUIDs). */
  issues: string[];
  loose: number;
}

function resolveIds(output: CoachOutput, prep: Prepared): { changes: FlatChange[]; loose: number } {
  let loose = 0;
  const changes = output.changes.map((c): FlatChange => {
    if (c.op === 'add') return { ...c, workoutId: null };
    const resolved = resolveWorkoutId(c.workoutId, { op: c.op, title: c.title, sport: c.sport, date: c.date }, prep.ids, prep.workouts, prep.context.today);
    if (resolved.loose) loose += 1;
    return resolved.id ? { ...c, workoutId: resolved.id } : c;
  });
  return { changes, loose };
}

/** plan_week: the plan the athlete imported (their coach) is the base of its weeks, nothing is added on top. */
export function dropAddsInImportedWeeks(changes: readonly PlanChange[], workouts: readonly Workout[]): { changes: PlanChange[]; dropped: number } {
  const imported = new Set(workouts.filter((w) => w.source === 'imported' && w.status !== 'skipped').map((w) => startOfWeek(w.date)));
  const kept = changes.filter((c) => c.op !== 'add' || !imported.has(startOfWeek(c.workout.date)));
  return { changes: kept, dropped: changes.length - kept.length };
}

export function validateOutput(output: CoachOutput, prep: Prepared): Validated {
  const resolved = resolveIds(output, prep);
  const converted = toPlanChanges(resolved.changes);
  const guarded = prep.mode === 'plan_week' ? dropAddsInImportedWeeks(converted.changes, prep.workouts) : { changes: converted.changes, dropped: 0 };
  const checked = checkChanges(guarded.changes, { weekStart: prep.context.weekStart, today: prep.context.today, workouts: prep.workouts });
  // Adds dropped by the imported-week guard are not issues: no repair re-prompt for them.
  const issues = [...converted.rejected, ...checked.issues].map((i) => shortenUuids(i.error, prep.ids));
  const valid = withDefaultCoaching(withSource(checked.valid, 'ai_coach'), prep.context.athlete.zones);
  return { changes: valid, dropped: issues.length + output.malformedChanges, issues, loose: resolved.loose };
}

// ---------------------------------------------------------------------------
// Attempts and the one repair
// ---------------------------------------------------------------------------

type Problem = 'cut' | 'bad_json' | 'dropped' | 'missing';

interface Attempt {
  text: string;
  output: CoachOutput | null;
  validated: Validated | null;
  problem: Problem | null;
  model: string;
}

function evaluate(response: ClaudeResponse, prep: Prepared): Attempt {
  if (response.stopReason === 'refusal') {
    throw new CoachAiError('refusal', 'El coach con IA no ha podido responder a esta petición. Reformúlala o usa el plan automático.');
  }
  const base = { text: response.text, model: response.model };
  if (response.stopReason === 'max_tokens') return { ...base, output: null, validated: null, problem: 'cut' };
  const parsed = parseCoachOutput(response.text);
  if (!parsed) return { ...base, output: null, validated: null, problem: 'bad_json' };
  const output = prep.contextOnly ? contextOnlyOutput(parsed) : parsed;
  const validated = validateOutput(output, prep);
  const proposed = output.changes.length + output.malformedChanges;
  const extrasOnly = output.week_plans !== null || output.quedada !== null;
  const problem: Problem | null =
    proposed > 0 && validated.changes.length === 0 ? 'dropped' : prep.wantsChange && proposed === 0 && !extrasOnly ? 'missing' : null;
  return { ...base, output, validated, problem };
}

function repairInstruction(problem: Problem, attempt: Attempt, prep: Prepared): string {
  const today = prep.context.today;
  const windowEnd = addDays(prep.context.weekStart, PLAN_WINDOW_DAYS - 1);
  const legend = idLegend(prep.context, prep.ids, today) || '(no hay entrenos planificados: usa add)';
  switch (problem) {
    case 'bad_json':
      return 'Tu respuesta anterior no era un JSON válido con el formato pedido. Repite la respuesta SOLO con el objeto JSON (reply, summary, changes, memory, life_event, quedada, week_plans), sin texto alrededor.';
    case 'cut':
      return 'Tu respuesta anterior se cortó por larga. Repite la respuesta completa pero más corta: reply de 2-3 frases, como mucho 8 cambios, prescription solo en las sesiones nuevas y con pocos pasos.';
    case 'dropped':
      return `Ninguno de tus cambios era válido: ${(attempt.validated?.issues ?? []).slice(0, 5).join('; ')}. Hoy es ${today}. Usa solo estos ids (entrenos planificados de hoy en adelante):\n${legend}\nRepite la respuesta completa con cambios que usen esos ids y fechas entre ${today} y ${windowEnd}.`;
    case 'missing':
      return `El atleta ha pedido un cambio en su plan y no has devuelto ninguno. Repite la respuesta completa con los cambios concretos en changes, usando estos ids:\n${legend}\nFechas entre ${today} y ${windowEnd}. Si de verdad no se puede, deja changes vacío y explica por qué en reply, sin decir que has cambiado nada.`;
  }
}

function repairMessages(prep: Prepared, attempt: Attempt, problem: Problem): ClaudeMessage[] {
  const previous = attempt.text.trim().slice(0, PREVIOUS_ANSWER_MAX) || '(respuesta vacía)';
  return [...prep.messages, { role: 'assistant', content: previous }, { role: 'user', content: repairInstruction(problem, attempt, prep) }];
}

/** The better of the two attempts: usable changes first, then any usable reply. */
function better(first: Attempt, second: Attempt): Attempt {
  const valid = (a: Attempt): number => a.validated?.changes.length ?? -1;
  if (!second.output) return first;
  if (!first.output) return second;
  if (valid(second) > 0 || second.problem === null) return second;
  return valid(first) >= valid(second) ? first : second;
}

async function withRepair(deps: CoachJobDeps, job: CoachJob, clock: Clock, prep: Prepared, first: Attempt, log: Logger): Promise<Attempt> {
  const problem = first.problem;
  if (!problem) return first;
  if (clock.remaining() < REPAIR_MIN_MS) {
    log.info('coach repair skipped: no time left', { problem });
    return first;
  }
  log.info('coach repair', { problem, issues: first.validated?.issues.slice(0, 5) ?? [] });
  try {
    const effort = problem === 'bad_json' || problem === 'cut' ? 'low' : prep.effort;
    const response = await callModel(deps, job, clock, repairMessages(prep, first, problem), effort, clock.remaining());
    return better(first, evaluate(response, prep));
  } catch (error) {
    if (clock.signal.aborted) throw timeoutError();
    // The repair failing must not lose a usable first answer.
    if (first.output) {
      log.warn('coach repair failed, keeping the first answer', errorInfo(error));
      return first;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

/** One friendly reason from the validation issues. */
export function friendlyIssue(issues: readonly string[]): string {
  const text = issues.join(' ');
  if (/ya ha pasado/.test(text)) return 'esa fecha ya ha pasado';
  if (/fuera de la ventana/.test(text)) return 'solo puedo tocar esta semana y la siguiente';
  if (/completado|saltado/.test(text)) return 'esa sesión ya está hecha o saltada';
  if (/no existe|workoutId|UUID/.test(text)) return 'no he encontrado esa sesión en tu plan';
  return 'el cambio no encajaba con tu calendario';
}

export function finalReply(reply: string, dropped: number, hasProposal: boolean): string {
  const trimmed = reply.trim().slice(0, 4000);
  const notes = [
    dropped > 0 ? `He descartado ${dropped} cambio${dropped === 1 ? '' : 's'} que no encajaba${dropped === 1 ? '' : 'n'} con tu calendario.` : '',
    hasProposal ? 'Revisa la propuesta y acepta los cambios que te convenzan.' : '',
  ].filter(Boolean);
  return notes.length ? `${trimmed}\n\n${notes.join(' ')}` : trimmed;
}

/** The reply as the athlete reads it: honest when no change survived. */
export function composeReply(output: CoachOutput, validated: Validated, hasProposal: boolean): string {
  const proposed = output.changes.length + output.malformedChanges;
  if (!hasProposal && proposed > 0) {
    return `No he podido preparar el cambio en tu plan: ${friendlyIssue(validated.issues)}. ${HOW_TO_ASK}`;
  }
  if (!hasProposal && claimsChanges(output.reply)) {
    return `No he podido preparar ese cambio en tu plan. ${HOW_TO_ASK}`;
  }
  return finalReply(output.reply, validated.dropped, hasProposal);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The validated changes as an ai_coach proposal (none without changes). */
async function storeProposal(
  deps: CoachJobDeps,
  job: CoachJob,
  context: PlanningContext,
  output: CoachOutput,
  changes: PlanChange[],
  model: string,
): Promise<UUID | null> {
  if (changes.length === 0) return null;
  return deps.store.insertProposal(job.userId, {
    kind: KIND[job.request.mode],
    source: 'ai_coach',
    weekStart: context.weekStart,
    summary: (output.summary || output.reply).slice(0, 1000),
    changes,
    model,
  });
}

function extrasFields(extras: CoachJobExtras): Record<string, unknown> {
  return {
    memory: extras.memory.length,
    lifeEvent: extras.lifeEventId !== null,
    quedada: extras.quedada !== null,
    weekPlans: extras.weekPlans?.length ?? 0,
  };
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

function attemptError(attempt: Attempt): CoachAiError {
  return attempt.problem === 'cut' ? new CoachAiError('max_tokens', CUT_MESSAGE) : new CoachAiError('bad_output', BAD_OUTPUT_MESSAGE);
}

/** Runs one job end to end. Never throws: failures are written to the job row. */
export async function runCoachJob(deps: CoachJobDeps, job: CoachJob): Promise<void> {
  const log = deps.logger.child({ jobId: job.jobId, mode: job.request.mode });
  const budget = deps.deadlineMs ?? COACH_DEADLINE_MS;
  const deadline = startDeadline(budget);
  const started = Date.now();
  const clock: Clock = { signal: deadline.signal, remaining: () => budget - (Date.now() - started) };
  try {
    const prep = await prepare(deps, job, clock.signal);
    const firstResponse = await callModel(deps, job, clock, prep.messages, prep.effort, FIRST_CALL_MAX_MS);
    const attempt = await withRepair(deps, job, clock, prep, evaluate(firstResponse, prep), log);
    if (!attempt.output || !attempt.validated) throw attemptError(attempt);
    const { output, validated } = attempt;
    // Past the deadline the app has already fallen back: do not add a competing proposal.
    if (clock.signal.aborted) throw timeoutError();
    const proposalId = await storeProposal(deps, job, prep.context, output, validated.changes, attempt.model);
    const extras = await withDeadline(applyCoachExtras(deps, job.userId, job.request, output, prep.context, log), clock.signal);
    const finished = await deps.store.finishJob(job.userId, job.jobId, {
      reply: composeReply(output, validated, proposalId !== null),
      proposalId,
      extras,
    });
    if (!finished) log.warn('coach job was no longer running when it finished', { proposalId });
    log.info('coach job done', {
      ms: Date.now() - started,
      changes: validated.changes.length,
      dropped: validated.dropped,
      loose: validated.loose,
      wantsChange: prep.wantsChange,
      ...extrasFields(extras),
    });
  } catch (error) {
    await markFailed(deps, job, log, error);
  } finally {
    deadline.dispose();
  }
}
