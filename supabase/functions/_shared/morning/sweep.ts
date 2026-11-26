/**
 * The wake-up sweep (pg_cron every 5 min → `morning` function): for every athlete
 * in wake mode who has not had today's briefing, decide (plan.ts) and act:
 * - wake-up known and due → one 'morning_briefing' notification (push-dispatch
 *   delivers it right away through the notifications insert trigger);
 * - inside the window with no wake-up yet → for Garmin athletes, a light pull of
 *   today's sleep at most every 10 min (2 Garmin calls: token + sleep), then decide again;
 * - nothing by the fallback time → the briefing anyway;
 * - more than 3 h late (cron down, data very late) → the day is settled without one.
 * `svc_send_morning_briefing` is idempotent per user and local day, so overlapping
 * sweeps or the app's own claim (HealthKit path) never send twice.
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { ISODate, UUID } from '../types.ts';
import { dueAtIso, planCandidate } from './plan.ts';
import type { CandidatePlan, WakeCandidate } from './plan.ts';

export interface SendBriefingInput {
  userId: UUID;
  date: ISODate;
  reason: 'wake' | 'fallback';
  sleepEnd: string | null;
  dueAt: string;
}

export interface MorningStore {
  listCandidates(nowIso: string): Promise<WakeCandidate[]>;
  /** Inserts today's notification unless the day is settled (sent, claimed, skipped); true when this call sent it. */
  sendBriefing(input: SendBriefingInput): Promise<boolean>;
  /** Settles the day without a notification (too late for one). */
  skipBriefing(userId: UUID, date: ISODate): Promise<boolean>;
  /** Remembers a light Garmin pull (throttle). */
  recordCheck(userId: UUID, date: ISODate): Promise<void>;
}

/** Today's night from the watch (light pull), or null when there is nothing (yet). */
export type SleepPuller = (userId: UUID, timezone: string, today: ISODate) => Promise<{ start: string | null; end: string | null } | null>;

export interface SweepDeps {
  store: MorningStore;
  /** Garmin light pull; null when Garmin is not configured on the server. */
  pullSleep: SleepPuller | null;
  now: () => Date;
  logger: Logger;
  /** Wall-clock budget (ms). */
  budgetMs?: number;
}

export interface SweepSummary {
  candidates: number;
  /** Sent after a detected wake-up. */
  sent: number;
  /** Sent at the fallback time (no wake-up detected). */
  fallbacks: number;
  /** Light Garmin pulls. */
  checked: number;
  waiting: number;
  /** Days settled without a notification (too late). */
  late: number;
  failed: number;
  /** Not looked at (time budget). */
  skipped: number;
}

/** A light Garmin pull per athlete at most this often (the sweep runs every 5 min). */
export const CHECK_EVERY_MIN = 10;
/** Cron jitter: a pull 9 min after the last one still counts as "10 min later". */
const CHECK_SLACK_MS = 60_000;

export function checkDue(lastCheckAt: string | null, now: Date): boolean {
  if (!lastCheckAt) return true;
  const last = Date.parse(lastCheckAt);
  return !Number.isFinite(last) || now.getTime() - last >= CHECK_EVERY_MIN * 60_000 - CHECK_SLACK_MS;
}

async function lookForWake(deps: SweepDeps, c: WakeCandidate, plan: CandidatePlan, summary: SweepSummary): Promise<CandidatePlan> {
  if (plan.decision.action !== 'check' || !c.garmin || !deps.pullSleep || !checkDue(c.lastCheckAt, deps.now())) return plan;
  await deps.store.recordCheck(c.userId, c.today);
  summary.checked += 1;
  const night = await deps.pullSleep(c.userId, c.timezone, c.today).catch((error: unknown) => {
    deps.logger.warn('wake sweep: sleep pull failed', { userId: c.userId, ...errorInfo(error) });
    return null;
  });
  if (!night?.end) return plan;
  return planCandidate({ ...c, nights: [...c.nights, { date: c.today, source: 'garmin', start: night.start, end: night.end }] });
}

async function handle(deps: SweepDeps, c: WakeCandidate, summary: SweepSummary): Promise<void> {
  const plan = await lookForWake(deps, c, planCandidate(c), summary);
  const { decision } = plan;
  if (decision.action === 'wait' && decision.reason === 'too_late') {
    if (await deps.store.skipBriefing(c.userId, c.today)) summary.late += 1;
    return;
  }
  if (decision.action !== 'send') {
    summary.waiting += 1;
    return;
  }
  const sent = await deps.store.sendBriefing({
    userId: c.userId,
    date: c.today,
    reason: decision.reason,
    sleepEnd: plan.wakeIso,
    dueAt: dueAtIso(c, plan),
  });
  if (!sent) return;
  if (decision.reason === 'wake') summary.sent += 1;
  else summary.fallbacks += 1;
}

export async function runWakeSweep(deps: SweepDeps): Promise<SweepSummary> {
  const started = deps.now().getTime();
  const budget = deps.budgetMs ?? 90_000;
  const candidates = await deps.store.listCandidates(deps.now().toISOString());
  const summary: SweepSummary = { candidates: candidates.length, sent: 0, fallbacks: 0, checked: 0, waiting: 0, late: 0, failed: 0, skipped: 0 };
  for (const c of candidates) {
    if (deps.now().getTime() - started > budget) {
      summary.skipped += 1;
      continue;
    }
    try {
      await handle(deps, c, summary);
    } catch (error) {
      summary.failed += 1;
      deps.logger.warn('wake sweep: candidate failed', { userId: c.userId, ...errorInfo(error) });
    }
  }
  return summary;
}
