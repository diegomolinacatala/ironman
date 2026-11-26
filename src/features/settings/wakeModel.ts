/**
 * "Aviso del informe" in wake mode (pure): the usual wake-up window learned from the
 * watch's nights (same domain module the server sweep uses), and the Spanish lines the
 * settings show — what the mode does, what it needs and when the fallback arrives.
 */
import { toISODate } from '@/domain/dates';
import type { DailyMetrics, ISODate, NotificationPrefs } from '@/domain/types';
import {
  WAKE_DELAYS,
  clockText,
  fallbackMinutes,
  fixedMinutesOf,
  learnWakeWindows,
  overrideWindow,
  wakeWindowFor,
  type LearnedWakeWindows,
  type LocalWake,
  type WakeWindow,
  type WindowSource,
} from '@/domain/wakeWindow';

export { WAKE_DELAYS };

/** One line: what the mode does and what it needs (DESIGN: short and calm). */
export const WAKE_MODE_HELP = 'Te llega unos minutos después de que tu reloj registre que te has despertado. Necesita que tu reloj sincronice el sueño.';

/** Device-local wake-ups of the nights in `metrics` (sleep end), one per row. */
export function localWakesFromMetrics(metrics: readonly DailyMetrics[]): LocalWake[] {
  return metrics.flatMap((m) => {
    if (!m.sleepEnd) return [];
    const end = new Date(m.sleepEnd);
    if (!Number.isFinite(end.getTime())) return [];
    return [{ date: toISODate(end), minutes: end.getHours() * 60 + end.getMinutes() }];
  });
}

export function learnedFromMetrics(metrics: readonly DailyMetrics[] | undefined, today: ISODate): LearnedWakeWindows {
  return learnWakeWindows(localWakesFromMetrics(metrics ?? []), today);
}

/** "06:30 y 08:30". */
function between(w: WakeWindow): string {
  return `${clockText(w.from)} y ${clockText(w.to)}`;
}

/** "de 06:30 a 08:30". */
function fromTo(w: WakeWindow): string {
  return `de ${clockText(w.from)} a ${clockText(w.to)}`;
}

function sameWindow(a: WakeWindow | null, b: WakeWindow | null): boolean {
  return a !== null && b !== null && a.from === b.from && a.to === b.to;
}

export interface WakeWindowView {
  /** Window used today. */
  window: WakeWindow;
  source: WindowSource;
  /** "Tu franja de despertar, según tu reloj: entre 06:10 y 08:10." */
  windowText: string;
  /** "Si tu reloj no dice nada, te llega a las 08:10." */
  fallbackText: string;
}

/** The learned window(s): the range we watch, from the earliest usual wake-up − 30' to the latest + 60'. */
function learnedText(learned: LearnedWakeWindows): string | null {
  const { weekday, weekend } = learned;
  if (weekday && weekend && !sameWindow(weekday, weekend)) {
    return `Tu franja de despertar, según tu reloj: entre semana, ${fromTo(weekday)}; el fin de semana, ${fromTo(weekend)}.`;
  }
  const one = weekday ?? weekend;
  return one ? `Tu franja de despertar, según tu reloj: entre ${between(one)}.` : null;
}

/** What the wake-mode settings say about the window and the fallback for `today`. */
export function wakeWindowView(prefs: NotificationPrefs, learned: LearnedWakeWindows, today: ISODate): WakeWindowView {
  const fixed = fixedMinutesOf(prefs);
  const override = overrideWindow(prefs.wakeWindow ?? null);
  const { window, source } = wakeWindowFor(today, { learned, override, fixedMinutes: fixed });
  const windowText =
    source === 'override'
      ? `Tu franja de despertar: entre ${between(window)}.`
      : source === 'learned'
        ? (learnedText(learned) ?? `Tu franja de despertar, según tu reloj: entre ${between(window)}.`)
        : `Aún no conocemos tu franja de despertar: miramos entre ${between(window)}.`;
  return {
    window,
    source,
    windowText,
    fallbackText: `Si tu reloj no dice nada, te llega a las ${clockText(fallbackMinutes(window, fixed))}.`,
  };
}

/** "5 min". */
export function delayLabel(minutes: number): string {
  return `${minutes} min`;
}

/** One line for the closed row: "Al despertar, 15 min después" / "Cada día a las 07:30". */
export function morningSubtitle(prefs: Pick<NotificationPrefs, 'morningMode' | 'wakeDelayMin' | 'morningTime'>): string {
  if (prefs.morningMode === 'wake') {
    const delay = typeof prefs.wakeDelayMin === 'number' ? prefs.wakeDelayMin : 15;
    return `Al despertar, ${delay} min después: cómo has dormido y qué toca.`;
  }
  return `Cada día a las ${prefs.morningTime}: cómo has dormido y qué toca.`;
}
