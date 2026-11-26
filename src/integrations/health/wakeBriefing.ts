/**
 * Wake-up briefing, Apple Salud path (best effort, iPhone only). Apple Salud only reaches the
 * server when the app syncs, so when it has the night that ended this morning (a background
 * wake from HealthKit, or the app opening), this iPhone:
 * 1. takes today's briefing from the server (`claimWakeBriefing`) so it is never pushed twice;
 * 2. schedules "Tu informe de hoy" itself at wake-up + delay (exact, no 5-minute sweep).
 * If the claim fails (offline, the server already sent it), nothing is scheduled here and the
 * server's push (detected wake-up or fallback) stays in charge. One run per local day.
 * Pure orchestration over injected dependencies (`useWakeBriefing` wires the real ones).
 */
import type { ISODate, NotificationPrefs } from '@/domain/types';
import { LATE_LIMIT_MIN, isMorningWake, morningModeOf, wakeDelayOf } from '@/domain/wakeWindow';

import { localDate } from '../time';
import type { SleepWindow } from './mapping';

export interface WakeBriefingDeps {
  /** The main sleep that ended today, from Apple Salud. */
  readLastNight(): Promise<SleepWindow | null>;
  /** True when this iPhone may show notifications. */
  canNotify(): Promise<boolean>;
  claim(input: { date: ISODate; sleepEnd: string; dueAt: string }): Promise<boolean>;
  schedule(date: ISODate, fireAt: Date): Promise<boolean>;
  /** Last local date settled on this iPhone for this account. */
  handledDay(): Promise<ISODate | null>;
  setHandledDay(date: ISODate): Promise<void>;
  now(): Date;
}

export type WakeBriefingOutcome =
  | 'off'
  | 'done_today'
  | 'no_night'
  | 'not_this_morning'
  | 'no_permission'
  | 'too_late'
  | 'taken'
  | 'scheduled'
  | 'not_scheduled';

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** What this iPhone did for today's briefing. Throws only when the claim fails (retried on the next update). */
export async function handleSleepUpdate(prefs: NotificationPrefs, deps: WakeBriefingDeps): Promise<WakeBriefingOutcome> {
  if (!prefs.morningSummary || morningModeOf(prefs) !== 'wake') return 'off';
  const now = deps.now();
  const today = localDate(now);
  if ((await deps.handledDay()) === today) return 'done_today';
  const night = await deps.readLastNight();
  if (!night) return 'no_night';
  const end = new Date(night.end);
  if (!Number.isFinite(end.getTime()) || localDate(end) !== today || !isMorningWake(minutesOfDay(end))) return 'not_this_morning';
  const due = new Date(end.getTime() + wakeDelayOf(prefs) * 60_000);
  if (now.getTime() - due.getTime() >= LATE_LIMIT_MIN * 60_000) {
    await deps.setHandledDay(today);
    return 'too_late';
  }
  if (!(await deps.canNotify())) return 'no_permission';
  const claimed = await deps.claim({ date: today, sleepEnd: end.toISOString(), dueAt: due.toISOString() });
  await deps.setHandledDay(today);
  if (!claimed) return 'taken';
  return (await deps.schedule(today, due)) ? 'scheduled' : 'not_scheduled';
}
