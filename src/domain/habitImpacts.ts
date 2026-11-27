/**
 * "Qué te afecta" (Whoop's Journal insights): for each habit, compares the
 * morning recovery on days answered "sí" with days answered "no". Recovery is
 * the watch-only readiness score (HRV, resting HR, sleep, the watch's own
 * readiness) so the subjective check-in cannot feed its own result. A habit
 * needs IMPACT_MIN_ANSWERS "sí" and "no" within IMPACT_WINDOW_DAYS before it
 * says anything. It is a correlation, never proof. Pure.
 */
import { HABITS } from './habitCatalog';
import { addDays } from './dates';
import { computeReadiness } from './readiness';
import type { DailyCheckin, DailyMetrics, HabitId, ISODate } from './types';

export const IMPACT_WINDOW_DAYS = 90;
export const IMPACT_MIN_ANSWERS = 5;
/** Differences smaller than this (readiness points) read as "sin efecto claro". */
export const IMPACT_NEUTRAL_POINTS = 3;

export type ImpactDirection = 'better' | 'worse' | 'neutral';

export interface HabitImpact {
  habit: HabitId;
  label: string;
  /** Days answered "sí" / "no" that also have a recovery score. */
  yesDays: number;
  noDays: number;
  /** Mean recovery on "sí" days minus "no" days (points); null until both reach the minimum. */
  delta: number | null;
  direction: ImpactDirection | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Watch-only readiness score of each date (null when the watch has nothing that day). */
function recoveryByDate(metrics: readonly DailyMetrics[], dates: readonly ISODate[]): Map<ISODate, number> {
  const scores = new Map<ISODate, number>();
  const all = [...metrics];
  for (const date of dates) {
    const { score } = computeReadiness({ today: date, checkin: null, metrics: all });
    if (score !== null) scores.set(date, score);
  }
  return scores;
}

function directionOf(delta: number): ImpactDirection {
  if (Math.abs(delta) < IMPACT_NEUTRAL_POINTS) return 'neutral';
  return delta > 0 ? 'better' : 'worse';
}

/**
 * Impact of each habit on recovery over the last IMPACT_WINDOW_DAYS days up to `today`.
 * Sorted: habits with a verdict first (largest effect first), then the ones still collecting.
 */
export function habitImpacts(input: {
  today: ISODate;
  habits: readonly HabitId[];
  checkins: readonly DailyCheckin[];
  metrics: readonly DailyMetrics[];
}): HabitImpact[] {
  const from = addDays(input.today, -(IMPACT_WINDOW_DAYS - 1));
  const recent = input.checkins.filter((c) => c.date >= from && c.date <= input.today);
  const recovery = recoveryByDate(
    input.metrics,
    recent.map((c) => c.date),
  );
  const impacts = input.habits.map((habit): HabitImpact => {
    const yes: number[] = [];
    const no: number[] = [];
    for (const c of recent) {
      const answer = c.habits[habit];
      const score = recovery.get(c.date);
      if (typeof answer !== 'boolean' || score === undefined) continue;
      (answer ? yes : no).push(score);
    }
    const ready = yes.length >= IMPACT_MIN_ANSWERS && no.length >= IMPACT_MIN_ANSWERS;
    const delta = ready ? Math.round(mean(yes) - mean(no)) : null;
    return {
      habit,
      label: HABITS[habit].label,
      yesDays: yes.length,
      noDays: no.length,
      delta,
      direction: delta === null ? null : directionOf(delta),
    };
  });
  return impacts.sort((a, b) => {
    if (a.delta !== null && b.delta !== null) return Math.abs(b.delta) - Math.abs(a.delta);
    if (a.delta !== null) return -1;
    if (b.delta !== null) return 1;
    return b.yesDays + b.noDays - (a.yesDays + a.noDays);
  });
}

/** "+7 puntos de recuperación los días que sí" / "Sin efecto claro" / "Faltan 2 «sí» y 1 «no»". */
export function impactSummary(impact: HabitImpact): string {
  if (impact.delta === null) {
    const missing = [
      impact.yesDays < IMPACT_MIN_ANSWERS ? `${IMPACT_MIN_ANSWERS - impact.yesDays} «sí»` : null,
      impact.noDays < IMPACT_MIN_ANSWERS ? `${IMPACT_MIN_ANSWERS - impact.noDays} «no»` : null,
    ].filter((p): p is string => p !== null);
    return `Faltan ${missing.join(' y ')} con datos del reloj`;
  }
  if (impact.direction === 'neutral') return 'Sin efecto claro en tu recuperación';
  const sign = impact.delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(impact.delta)} puntos de recuperación los días que sí`;
}
