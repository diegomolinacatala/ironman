/**
 * Deterministic "coach" built on the domain rules engine. Used by the demo
 * repository and as the offline / AI-unavailable fallback of the Supabase
 * repository. Reads everything through the Repository interface and stores
 * proposals with `source: 'rules'`.
 */
import { addDays, maxDate, startOfWeek } from '@/domain/dates';
import { computeReadiness } from '@/domain/readiness';
import { generateWeek } from '@/domain/planner';
import { replanForEvent, replanForReadiness, replanMissed } from '@/domain/replanner';
import type {
  BusyBlock,
  CoachRequest,
  CoachResponse,
  DailyCheckin,
  DailyMetrics,
  ISODate,
  JointSession,
  LifeEvent,
  PlanChange,
  ProposalKind,
  Profile,
  Race,
  Workout,
} from '@/domain/types';

import { RepositoryError, type Repository } from '../repository';
import { buildChatReply } from './coachReply';

/** Shared part of the replanner inputs (domain `ReplanInput`). */
type ReplanInput = Omit<Parameters<typeof replanForReadiness>[0], 'readiness'>;

export type RulesCoachRepo = Pick<
  Repository,
  | 'getMyProfile'
  | 'listRaces'
  | 'listWorkouts'
  | 'listLifeEvents'
  | 'listBusyBlocks'
  | 'listJointSessions'
  | 'listCheckins'
  | 'listMetrics'
  | 'createProposal'
>;

export interface RulesCoachOptions {
  today: ISODate;
  /** Prepended to the reply (e.g. why the AI coach was not used). */
  notice?: string;
  /** The injury in the message is already logged as an imprevisto (demo coach). */
  injuryLogged?: boolean;
}

export type Readiness = ReturnType<typeof computeReadiness>;

export interface CoachContext {
  today: ISODate;
  weekStart: ISODate;
  profile: Profile;
  races: Race[];
  weekWorkouts: Workout[];
  lifeEvents: LifeEvent[];
  busyBlocks: BusyBlock[];
  jointSessions: JointSession[];
  checkins: DailyCheckin[];
  metrics: DailyMetrics[];
  readiness: Readiness;
  recentWeeklyMinutes: number[];
  /** Completed workouts of the last ~4 weeks (planner ramp control). */
  history: Workout[];
  upcoming: Workout[];
}

interface PlanResult {
  changes: PlanChange[];
  summary: string;
}

const KIND_BY_MODE: Record<CoachRequest['mode'], ProposalKind> = {
  plan_week: 'generate_week',
  replan: 'replan',
  chat: 'chat',
};

function completedMinutes(w: Workout): number {
  if (w.status !== 'completed') return 0;
  return w.completed?.durationMin ?? w.durationMin;
}

/** Completed minutes of each of the 4 weeks before `weekStart` (oldest first). */
export function recentWeeklyMinutesOf(workouts: readonly Workout[], weekStart: ISODate): number[] {
  return [4, 3, 2, 1].map((weeksAgo) => {
    const from = addDays(weekStart, -7 * weeksAgo);
    const to = addDays(from, 6);
    return workouts.filter((w) => w.date >= from && w.date <= to).reduce((sum, w) => sum + completedMinutes(w), 0);
  });
}

/**
 * Life events keep restricting training after they end (illness return, injury
 * minimum windows, the 48 h after a match…), so the engines get every event
 * that ended up to this many days before the week starts.
 */
export const EVENT_LOOKBACK_DAYS = 14;
/** Events this many days after the week still shape hard-day spacing at its end. */
export const EVENT_LOOKAHEAD_DAYS = 7;
/** Window searched for the event of an event re-plan (it may be weeks away). */
const EVENT_SEARCH_PAST_DAYS = 28;
const EVENT_SEARCH_FUTURE_DAYS = 365;

function overlaps(e: LifeEvent, from: ISODate, to: ISODate): boolean {
  return e.startDate <= to && e.endDate >= from;
}

/** Events that can still affect the week starting `weekStart` (pure). */
export function lifeEventsAffectingWeek(events: readonly LifeEvent[], weekStart: ISODate): LifeEvent[] {
  return events.filter((e) => overlaps(e, addDays(weekStart, -EVENT_LOOKBACK_DAYS), addDays(weekStart, 6 + EVENT_LOOKAHEAD_DAYS)));
}

/**
 * Week a coach request works on. An event re-plan targets the week the event
 * affects (the `/coach?lifeEventId=…` route defaults to the current week),
 * unless the requested week is current or future and overlaps the event.
 */
export function targetWeekStart(request: CoachRequest, today: ISODate, event: LifeEvent | null): ISODate {
  const requested = startOfWeek(request.weekStart || today);
  if (!event) return requested;
  if (requested >= startOfWeek(today) && overlaps(event, requested, addDays(requested, 6))) return requested;
  return startOfWeek(maxDate(event.startDate, today));
}

async function findReplanEvent(repo: RulesCoachRepo, request: CoachRequest, today: ISODate): Promise<LifeEvent | null> {
  if (request.mode !== 'replan' || !request.lifeEventId) return null;
  const events = await repo.listLifeEvents({
    from: addDays(today, -EVENT_SEARCH_PAST_DAYS),
    to: addDays(today, EVENT_SEARCH_FUTURE_DAYS),
  });
  return events.find((e) => e.id === request.lifeEventId) ?? null;
}

function withEvent(events: readonly LifeEvent[], event: LifeEvent | null): LifeEvent[] {
  return event && !events.some((e) => e.id === event.id) ? [...events, event] : [...events];
}

export async function loadCoachContext(repo: RulesCoachRepo, request: CoachRequest, today: ISODate): Promise<CoachContext> {
  const profile = await repo.getMyProfile();
  if (!profile) throw new RepositoryError('validation', 'Completa tu perfil para que pueda planificar tu semana.');
  const replanEvent = await findReplanEvent(repo, request, today);
  const weekStart = targetWeekStart(request, today, replanEvent);
  const weekEnd = addDays(weekStart, 6);
  const historyFrom = addDays(weekStart, -28);
  const [races, workouts, events, busyBlocks, jointSessions, checkins, metrics, upcoming] = await Promise.all([
    repo.listRaces(),
    repo.listWorkouts({ from: historyFrom, to: weekEnd }),
    repo.listLifeEvents({ from: addDays(weekStart, -EVENT_LOOKBACK_DAYS), to: addDays(weekEnd, 14) }),
    repo.listBusyBlocks({ from: weekStart, to: weekEnd }),
    repo.listJointSessions({ from: weekStart, to: weekEnd }),
    repo.listCheckins({ from: addDays(today, -28), to: today }),
    repo.listMetrics({ from: addDays(today, -28), to: today }),
    repo.listWorkouts({ from: today, to: addDays(today, 7) }),
  ]);
  const readiness = computeReadiness({
    today,
    checkin: checkins.find((c) => c.date === today) ?? null,
    metrics,
  });
  return {
    today,
    weekStart,
    profile,
    races,
    weekWorkouts: workouts.filter((w) => w.date >= weekStart && w.date <= weekEnd),
    lifeEvents: withEvent(events, replanEvent),
    busyBlocks,
    jointSessions,
    checkins,
    metrics,
    readiness,
    recentWeeklyMinutes: recentWeeklyMinutesOf(workouts, weekStart),
    history: workouts.filter((w) => w.status === 'completed' && w.date < today),
    upcoming: upcoming.filter((w) => w.status === 'planned'),
  };
}

function weekEvents(ctx: CoachContext): LifeEvent[] {
  return lifeEventsAffectingWeek(ctx.lifeEvents, ctx.weekStart);
}

function replanInput(ctx: CoachContext): ReplanInput {
  return {
    // The replanner edits [today, today + 6]: a future week starts on its Monday.
    today: maxDate(ctx.today, ctx.weekStart),
    weekWorkouts: ctx.weekWorkouts,
    profile: ctx.profile,
    busyBlocks: ctx.busyBlocks,
    lifeEvents: weekEvents(ctx),
    jointSessions: ctx.jointSessions,
    races: ctx.races,
  };
}

const FATIGUE_RE = /cansad|fatig|agotad|revent|sin energ|mal dormid|dormido mal|duermo mal|reventad/i;

/** Without NLU, treat "estoy cansado/a"-style messages as an amber readiness signal. */
export function readinessFromMessage(base: Readiness, message: string | undefined): Readiness {
  if (!message || !FATIGUE_RE.test(message) || base.level === 'red' || base.level === 'amber') return base;
  return {
    ...base,
    level: 'amber',
    factors: [...base.factors, 'Dices que estás cansado/a'],
    recommendation: 'Baja la intensidad unos días y prioriza dormir bien.',
  };
}

function runReplan(ctx: CoachContext, request: CoachRequest): PlanResult {
  const event = request.lifeEventId ? ctx.lifeEvents.find((e) => e.id === request.lifeEventId) : undefined;
  if (event) return replanForEvent({ ...replanInput(ctx), event });
  const missed = ctx.weekWorkouts.filter((w) => w.status === 'planned' && w.date < ctx.today);
  const readiness = readinessFromMessage(ctx.readiness, request.message);
  if (missed.length > 0 && readiness === ctx.readiness) return replanMissed({ ...replanInput(ctx), missed });
  return replanForReadiness({ ...replanInput(ctx), readiness });
}

export function planForRequest(request: CoachRequest, ctx: CoachContext): PlanResult | null {
  if (request.mode === 'chat') return null;
  if (request.mode === 'replan') return runReplan(ctx, request);
  return generateWeek({
    weekStart: ctx.weekStart,
    profile: ctx.profile,
    races: ctx.races,
    existing: ctx.weekWorkouts,
    lifeEvents: weekEvents(ctx),
    busyBlocks: ctx.busyBlocks,
    jointSessions: ctx.jointSessions,
    readiness: ctx.readiness,
    recentWeeklyMinutes: ctx.recentWeeklyMinutes,
    today: ctx.today,
    history: ctx.history,
  });
}

/** The rules engine neither saves preferences nor logs imprevistos by itself. */
const NOTHING_REMEMBERED: Pick<CoachResponse, 'memory' | 'lifeEvent'> = { memory: [], lifeEvent: null };

function withNotice(notice: string | undefined, text: string): string {
  return notice ? `${notice}\n\n${text}` : text;
}

function changesSentence(count: number): string {
  return count === 1
    ? 'Te he preparado 1 cambio: revísalo y acéptalo si te encaja.'
    : `Te he preparado ${count} cambios: revísalos y acepta los que te encajen.`;
}

/** Runs the rules engine for a coach request and stores the proposal (if any). */
export async function runRulesCoach(
  repo: RulesCoachRepo,
  request: CoachRequest,
  options: RulesCoachOptions,
): Promise<CoachResponse> {
  const ctx = await loadCoachContext(repo, request, options.today);
  const plan = planForRequest(request, ctx);
  if (!plan) {
    const reply = buildChatReply({ message: request.message ?? '', ctx, injuryLogged: options.injuryLogged });
    return { reply: withNotice(options.notice, reply), proposal: null, engine: 'rules', ...NOTHING_REMEMBERED };
  }
  if (plan.changes.length === 0) {
    const summary = plan.summary || 'Tu semana ya está bien encajada: no veo cambios necesarios.';
    return { reply: withNotice(options.notice, summary), proposal: null, engine: 'rules', ...NOTHING_REMEMBERED };
  }
  const proposal = await repo.createProposal({
    kind: KIND_BY_MODE[request.mode],
    source: 'rules',
    weekStart: ctx.weekStart,
    summary: plan.summary,
    changes: plan.changes,
    model: null,
  });
  const reply = `${plan.summary}\n\n${changesSentence(plan.changes.length)}`;
  return { reply: withNotice(options.notice, reply), proposal, engine: 'rules', ...NOTHING_REMEMBERED };
}
