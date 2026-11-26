/**
 * Pure per-athlete decision of the wake-up sweep ("Tu informe de hoy" when you
 * wake up): the usual window learned from the watch's nights (mirrored domain
 * module wakeWindow.ts, same as the app shows), today's wake-up and what to do now.
 */
import { localParts, zonedToUtc } from '../dates.ts';
import {
  clockMinutes,
  clockText,
  decideWake,
  fallbackMinutes,
  fixedMinutesOf,
  learnWakeWindows,
  overrideWindow,
  wakeDelayOf,
  wakeWindowFor,
  type LocalWake,
  type WakeDecision,
  type WakeWindow,
  type WindowSource,
} from '../planning/domain/wakeWindow.ts';
import type { ISODate, UUID } from '../types.ts';

/** One `daily_metrics` night (`date` = the day it ends, by each source's convention). */
export interface NightRow {
  date: ISODate;
  source: string;
  /** ISO instants. */
  start: string | null;
  end: string | null;
}

/** A user in wake mode who has not had today's briefing yet (svc_wake_candidates). */
export interface WakeCandidate {
  userId: UUID;
  timezone: string;
  /** Local date and minutes since midnight now, in the profile's zone. */
  today: ISODate;
  nowMinutes: number;
  prefs: Record<string, unknown>;
  /** Garmin Personal API connected (the sweep can pull today's sleep). */
  garmin: boolean;
  /** Last light Garmin pull today, ISO. */
  lastCheckAt: string | null;
  /** Nights of the last ~3 weeks, any source. */
  nights: NightRow[];
}

export interface CandidatePlan {
  window: WakeWindow;
  source: WindowSource;
  fallbackAt: number;
  delayMin: number;
  /** Today's wake-up: local minutes and instant. */
  wake: number | null;
  wakeIso: string | null;
  decision: WakeDecision;
}

/** Merge priority everywhere: garmin > coros > healthkit > manual. */
const SOURCE_RANK: Readonly<Record<string, number>> = { garmin: 0, coros: 1, healthkit: 2, manual: 3 };

const rank = (source: string): number => SOURCE_RANK[source] ?? 9;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function prefsOf(prefs: Record<string, unknown>) {
  const window = prefs.wakeWindow;
  const w = window && typeof window === 'object' ? (window as Record<string, unknown>) : null;
  return {
    morningMode: asString(prefs.morningMode),
    morningTime: asString(prefs.morningTime),
    wakeDelayMin: typeof prefs.wakeDelayMin === 'number' ? prefs.wakeDelayMin : null,
    wakeWindow: w ? { from: asString(w.from) ?? '', to: asString(w.to) ?? '' } : null,
  };
}

interface WakeAt {
  wake: LocalWake;
  iso: string;
  rank: number;
}

/** One wake-up per local date (best source first), from the end of each night. */
export function localWakes(nights: readonly NightRow[], timezone: string): (LocalWake & { iso: string })[] {
  const best = new Map<ISODate, WakeAt>();
  for (const n of nights) {
    if (!n.end || !Number.isFinite(Date.parse(n.end))) continue;
    const parts = localParts(n.end, timezone);
    const minutes = clockMinutes(parts.time);
    if (minutes === null) continue;
    const current = best.get(parts.date);
    if (current && current.rank <= rank(n.source)) continue;
    best.set(parts.date, { wake: { date: parts.date, minutes }, iso: new Date(n.end).toISOString(), rank: rank(n.source) });
  }
  return [...best.values()].map((w) => ({ ...w.wake, iso: w.iso }));
}

/** A night of today with a start and no end: the athlete is (as far as we know) still asleep. */
function stillAsleep(nights: readonly NightRow[], today: ISODate): boolean {
  return nights.some((n) => n.date === today && n.start !== null && n.end === null);
}

export function planCandidate(c: WakeCandidate): CandidatePlan {
  const prefs = prefsOf(c.prefs);
  const wakes = localWakes(c.nights, c.timezone);
  const todayWake = wakes.find((w) => w.date === c.today) ?? null;
  const fixed = fixedMinutesOf(prefs);
  const { window, source } = wakeWindowFor(c.today, {
    learned: learnWakeWindows(wakes, c.today),
    override: overrideWindow(prefs.wakeWindow),
    fixedMinutes: fixed,
  });
  const fallbackAt = fallbackMinutes(window, fixed);
  const delayMin = wakeDelayOf(prefs);
  const wake = todayWake?.minutes ?? null;
  const decision = decideWake({
    nowMinutes: c.nowMinutes,
    window,
    fallbackAt,
    delayMin,
    wake,
    stillAsleep: wake === null && stillAsleep(c.nights, c.today),
  });
  return { window, source, fallbackAt, delayMin, wake, wakeIso: todayWake?.iso ?? null, decision };
}

/** When the briefing was due: wake-up + delay, or the fallback time today in the athlete's zone. */
export function dueAtIso(c: Pick<WakeCandidate, 'today' | 'timezone'>, plan: CandidatePlan): string {
  if (plan.decision.action === 'send' && plan.decision.reason === 'wake' && plan.wakeIso) {
    return new Date(Date.parse(plan.wakeIso) + plan.delayMin * 60_000).toISOString();
  }
  return zonedToUtc(c.today, clockText(plan.fallbackAt), c.timezone);
}
