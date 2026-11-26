// GENERATED MIRROR of src/domain/wakeWindow.ts — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * "Tu informe de hoy" when you wake up (notification mode 'wake'): the athlete's
 * usual wake-up window learned from their watch, and what to do now — wait, keep
 * looking for the wake-up, or send the briefing `delay` minutes after it (or at
 * the fallback time when the watch says nothing).
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs: the app shows the same window the server
 * uses. Time-zone free: callers pass local dates and minutes since local
 * midnight (the profile's zone), so import only `dates` and `types` here.
 */
import { addDays, weekdayOf } from './dates.ts';
import type { ISODate } from './types.ts';

/** How "Tu informe de hoy" is timed: at the fixed time (default) or after the watch reports the wake-up. */
export const MORNING_MODES = ['fixed', 'wake'] as const;
export type MorningMode = (typeof MORNING_MODES)[number];

/** Minutes after waking up the athlete can pick. */
export const WAKE_DELAYS = [5, 10, 15, 30] as const;
export const DEFAULT_WAKE_DELAY = 15;

/** Nights looked at to learn the window. */
export const WAKE_HISTORY_DAYS = 21;
/** The window opens this long before the earliest usual wake-up… */
export const WINDOW_EARLY_MIN = 30;
/** …and closes this long after the latest one. */
export const WINDOW_LATE_MIN = 60;
/** Without enough history: the window ends at the fixed time and opens this long before it. */
export const DEFAULT_WINDOW_MIN = 120;
/** "Still asleep" holds the fallback back at most this long. */
export const ASLEEP_HOLD_MIN = 180;
/** No briefing notification more than this long after it was due (stale). */
export const LATE_LIMIT_MIN = 180;

/** Wake-ups outside 03:00–13:00 are naps, night shifts or data glitches, not the morning wake-up. */
const MORNING_FROM = 3 * 60;
const MORNING_TO = 13 * 60;
/** Bounds of any window: 04:00–13:00. */
const WINDOW_MIN = 4 * 60;
const WINDOW_MAX = 13 * 60;
const MIN_NIGHTS = 4;
const MIN_WEEKDAY_NIGHTS = 4;
const MIN_WEEKEND_NIGHTS = 3;
/** With this many nights, the earliest and the latest are dropped (a race day, a late party). */
const TRIM_FROM_NIGHTS = 7;

/** Local wall clock of a night's end: the local date and minutes since midnight. */
export interface LocalWake {
  date: ISODate;
  minutes: number;
}

/** Minutes since local midnight, `from` < `to`. */
export interface WakeWindow {
  from: number;
  to: number;
}

export interface LearnedWakeWindows {
  /** Monday–Friday (or every day when the weekend has too few nights). */
  weekday: WakeWindow | null;
  /** Saturday–Sunday (or every day when it has too few nights). */
  weekend: WakeWindow | null;
  /** Nights the windows come from. */
  nights: number;
}

export type WindowSource = 'override' | 'learned' | 'default';

export interface WakePrefsLike {
  morningMode?: MorningMode | string | null;
  wakeDelayMin?: number | null;
  /** 'HH:mm' strings. */
  wakeWindow?: { from: string; to: string } | null;
  morningTime?: string | null;
}

const DEFAULT_FIXED_MIN = 7 * 60 + 30;

function floor5(n: number): number {
  return Math.floor(n / 5) * 5;
}

function ceil5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/** 'HH:mm' → minutes since midnight, or null. */
export function clockMinutes(value: string | null | undefined): number | null {
  const match = value ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 390 → "06:30". */
export function clockText(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** True for a plausible morning wake-up (03:00–13:00). */
export function isMorningWake(minutes: number): boolean {
  return Number.isFinite(minutes) && minutes >= MORNING_FROM && minutes < MORNING_TO;
}

export function isWeekend(date: ISODate): boolean {
  return weekdayOf(date) >= 5;
}

function windowOf(minutes: readonly number[]): WakeWindow {
  const sorted = [...minutes].sort((a, b) => a - b);
  const kept = sorted.length >= TRIM_FROM_NIGHTS ? sorted.slice(1, -1) : sorted;
  const earliest = kept[0] ?? DEFAULT_FIXED_MIN;
  const latest = kept[kept.length - 1] ?? earliest;
  return { from: Math.max(WINDOW_MIN, floor5(earliest - WINDOW_EARLY_MIN)), to: Math.min(WINDOW_MAX, ceil5(latest + WINDOW_LATE_MIN)) };
}

/** One wake-up per date (the latest morning one) from the nights before `today`. */
function usableWakes(wakes: readonly LocalWake[], today: ISODate): LocalWake[] {
  const first = addDays(today, -WAKE_HISTORY_DAYS);
  const byDate = new Map<ISODate, number>();
  for (const w of wakes) {
    if (w.date < first || w.date >= today || !isMorningWake(w.minutes)) continue;
    byDate.set(w.date, Math.max(byDate.get(w.date) ?? -1, w.minutes));
  }
  return [...byDate.entries()].map(([date, minutes]) => ({ date, minutes }));
}

/**
 * The usual wake-up window from the last three weeks: earliest − 30 min to
 * latest + 60 min, with separate weekday and weekend windows when each has
 * enough nights (else the all-days window, else null).
 */
export function learnWakeWindows(wakes: readonly LocalWake[], today: ISODate): LearnedWakeWindows {
  const usable = usableWakes(wakes, today);
  const all = usable.map((w) => w.minutes);
  const weekday = usable.filter((w) => !isWeekend(w.date)).map((w) => w.minutes);
  const weekend = usable.filter((w) => isWeekend(w.date)).map((w) => w.minutes);
  const allWindow = all.length >= MIN_NIGHTS ? windowOf(all) : null;
  return {
    weekday: weekday.length >= MIN_WEEKDAY_NIGHTS ? windowOf(weekday) : allWindow,
    weekend: weekend.length >= MIN_WEEKEND_NIGHTS ? windowOf(weekend) : allWindow,
    nights: usable.length,
  };
}

/** The athlete's own window ("06:30"–"08:30"), or null when absent or invalid. */
export function overrideWindow(value: { from: string; to: string } | null | undefined): WakeWindow | null {
  const from = clockMinutes(value?.from);
  const to = clockMinutes(value?.to);
  return from !== null && to !== null && from < to ? { from, to } : null;
}

/** Without history: the two hours before the fixed time. */
export function defaultWindow(fixedMinutes: number): WakeWindow {
  const to = Math.max(WINDOW_MIN + 30, Math.min(WINDOW_MAX, fixedMinutes));
  return { from: Math.max(WINDOW_MIN, to - DEFAULT_WINDOW_MIN), to };
}

/** The window that applies on `date`: the athlete's own, the learned one for that kind of day, or the default. */
export function wakeWindowFor(
  date: ISODate,
  input: { learned: LearnedWakeWindows; override: WakeWindow | null; fixedMinutes: number },
): { window: WakeWindow; source: WindowSource } {
  if (input.override) return { window: input.override, source: 'override' };
  const learned = isWeekend(date) ? input.learned.weekend : input.learned.weekday;
  if (learned) return { window: learned, source: 'learned' };
  return { window: defaultWindow(input.fixedMinutes), source: 'default' };
}

/** With no wake-up detected: at the end of the window, or at the fixed time if that is later. */
export function fallbackMinutes(window: WakeWindow, fixedMinutes: number): number {
  return Math.max(window.to, fixedMinutes);
}

/** Delay (minutes) from the prefs: one of WAKE_DELAYS, else the default. */
export function wakeDelayOf(prefs: WakePrefsLike | null | undefined): number {
  const value = prefs?.wakeDelayMin;
  return typeof value === 'number' && (WAKE_DELAYS as readonly number[]).includes(value) ? value : DEFAULT_WAKE_DELAY;
}

export function morningModeOf(prefs: WakePrefsLike | null | undefined): MorningMode {
  return prefs?.morningMode === 'wake' ? 'wake' : 'fixed';
}

export function fixedMinutesOf(prefs: WakePrefsLike | null | undefined): number {
  return clockMinutes(prefs?.morningTime) ?? DEFAULT_FIXED_MIN;
}

// ---------------------------------------------------------------------------
// What to do now
// ---------------------------------------------------------------------------

export interface WakeCheck {
  /** Local minutes since midnight now (same local day as the window). */
  nowMinutes: number;
  window: WakeWindow;
  fallbackAt: number;
  delayMin: number;
  /** Local minutes of today's wake-up (end of the night that ends today), null when unknown. */
  wake: number | null;
  /** The night has a known start but no end yet. */
  stillAsleep: boolean;
}

export type WakeDecision =
  | { action: 'wait'; reason: 'before_window' | 'due_later' | 'asleep' | 'too_late' }
  /** Inside the window with no wake-up yet: look for it (e.g. pull the watch's sleep). */
  | { action: 'check' }
  | { action: 'send'; reason: 'wake' | 'fallback'; dueMinutes: number };

/**
 * Wake-up known → send `delay` minutes after it (at once when that moment has
 * passed). Unknown → wait until the window opens, look for it inside the window,
 * and fall back at `fallbackAt` — held back while the night is known to go on.
 * Nothing is sent more than three hours late.
 */
export function decideWake(c: WakeCheck): WakeDecision {
  const wake = c.wake !== null && isMorningWake(c.wake) ? c.wake : null;
  if (wake !== null) {
    const due = wake + c.delayMin;
    if (c.nowMinutes < due) return { action: 'wait', reason: 'due_later' };
    if (c.nowMinutes >= Math.max(due, c.fallbackAt) + LATE_LIMIT_MIN) return { action: 'wait', reason: 'too_late' };
    return { action: 'send', reason: 'wake', dueMinutes: due };
  }
  if (c.nowMinutes < c.window.from) return { action: 'wait', reason: 'before_window' };
  if (c.nowMinutes < c.fallbackAt) return { action: 'check' };
  if (c.stillAsleep && c.nowMinutes < c.fallbackAt + ASLEEP_HOLD_MIN) return { action: 'wait', reason: 'asleep' };
  if (c.nowMinutes >= c.fallbackAt + LATE_LIMIT_MIN) return { action: 'wait', reason: 'too_late' };
  return { action: 'send', reason: 'fallback', dueMinutes: c.fallbackAt };
}
