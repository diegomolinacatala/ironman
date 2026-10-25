/**
 * Training load estimates ("Carga", ≈ TSS points: 100 = 1 h at threshold).
 * Same heuristics as the app's domain/load (docs/research/02 §3): completed TSS
 * → session RPE → planned TSS → duration × IF² table.
 */
import { addDays, diffDays } from '../dates.ts';
import type { ISODate, Intensity, LifeEvent, Sport, Workout } from '../types.ts';

export const INTENSITY_IF: Record<Intensity, number> = {
  recovery: 0.55,
  endurance: 0.68,
  tempo: 0.8,
  threshold: 0.9,
  vo2: 0.95,
  race: 0.85,
};

const RPE_TO_IF: Record<number, number> = {
  1: 0.5,
  2: 0.55,
  3: 0.62,
  4: 0.7,
  5: 0.76,
  6: 0.82,
  7: 0.88,
  8: 0.94,
  9: 1.0,
  10: 1.08,
};

const PER_HOUR_FIXED: Partial<Record<Sport, number>> = { strength: 35, mobility: 15, rest: 0 };
const OTHER_SPORT_PER_HOUR: Partial<Record<LifeEvent['kind'], number>> = { padel: 55, football: 78, other_sport: 55 };

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function estimateTss(w: { sport: Sport; durationMin: number; intensity: Intensity }): number {
  const hours = Math.max(0, w.durationMin) / 60;
  const fixed = PER_HOUR_FIXED[w.sport];
  if (fixed !== undefined) return round1(hours * fixed);
  const intensityFactor = INTENSITY_IF[w.intensity] ?? 0.68;
  return round1(hours * intensityFactor * intensityFactor * 100);
}

export function workoutLoad(w: Workout): number {
  if (w.status === 'skipped' || w.sport === 'rest') return 0;
  if (w.status === 'completed') {
    const c = w.completed ?? {};
    if (typeof c.tss === 'number') return round1(c.tss);
    const minutes = typeof c.durationMin === 'number' ? c.durationMin : w.durationMin;
    if (typeof c.rpe === 'number' && RPE_TO_IF[Math.round(c.rpe)]) {
      const f = RPE_TO_IF[Math.round(c.rpe)];
      return round1((minutes / 60) * f * f * 100);
    }
    return estimateTss({ sport: w.sport, durationMin: minutes, intensity: w.intensity });
  }
  return typeof w.tss === 'number' ? round1(w.tss) : estimateTss(w);
}

export function lifeEventLoad(e: LifeEvent): number {
  const perHour = OTHER_SPORT_PER_HOUR[e.kind];
  if (perHour === undefined) return 0;
  const minutes = e.durationMin ?? 60;
  return round1((minutes / 60) * perHour * (0.8 + 0.1 * e.severity));
}

export interface SportTotals {
  plannedMin: number;
  completedMin: number;
  count: number;
}

export interface WeekTotals {
  sessions: number;
  completedSessions: number;
  plannedMin: number;
  completedMin: number;
  plannedLoad: number;
  completedLoad: number;
  bySport: Partial<Record<Sport, SportTotals>>;
}

export function weekTotals(workouts: readonly Workout[]): WeekTotals {
  return workouts
    .filter((w) => w.sport !== 'rest')
    .reduce<WeekTotals>(
      (acc, w) => {
        const done = w.status === 'completed';
        const minutesDone = done ? (w.completed?.durationMin ?? w.durationMin) : 0;
        const prev = acc.bySport[w.sport] ?? { plannedMin: 0, completedMin: 0, count: 0 };
        const plannedLoad = typeof w.tss === 'number' ? w.tss : estimateTss(w);
        return {
          sessions: acc.sessions + 1,
          completedSessions: acc.completedSessions + (done ? 1 : 0),
          plannedMin: acc.plannedMin + w.durationMin,
          completedMin: acc.completedMin + minutesDone,
          plannedLoad: round1(acc.plannedLoad + plannedLoad),
          completedLoad: round1(acc.completedLoad + (done ? workoutLoad(w) : 0)),
          bySport: {
            ...acc.bySport,
            [w.sport]: {
              plannedMin: prev.plannedMin + w.durationMin,
              completedMin: prev.completedMin + minutesDone,
              count: prev.count + 1,
            },
          },
        };
      },
      { sessions: 0, completedSessions: 0, plannedMin: 0, completedMin: 0, plannedLoad: 0, completedLoad: 0, bySport: {} },
    );
}

export interface WeeklyLoad {
  weekStart: ISODate;
  completedSessions: number;
  completedMin: number;
  /** Completed training load + other sports (pádel, fútbol…) logged as life events. */
  load: number;
}

/** Completed volume and load for each of the `weeks` Mondays before `beforeWeekStart`. */
export function weeklyLoadHistory(
  workouts: readonly Workout[],
  events: readonly LifeEvent[],
  beforeWeekStart: ISODate,
  weeks: number,
): WeeklyLoad[] {
  return Array.from({ length: weeks }, (_, i) => addDays(beforeWeekStart, -7 * (weeks - i))).map((weekStart) => {
    const inWeek = (date: ISODate): boolean => {
      const d = diffDays(date, weekStart);
      return d >= 0 && d < 7;
    };
    const done = workouts.filter((w) => w.status === 'completed' && inWeek(w.date));
    const otherLoad = events.filter((e) => inWeek(e.startDate)).reduce((sum, e) => sum + lifeEventLoad(e), 0);
    return {
      weekStart,
      completedSessions: done.length,
      completedMin: done.reduce((sum, w) => sum + (w.completed?.durationMin ?? w.durationMin), 0),
      load: round1(done.reduce((sum, w) => sum + workoutLoad(w), 0) + otherLoad),
    };
  });
}

/** Best-effort intensity of an executed activity from RPE, else TSS per hour. */
export function intensityFromEffort(e: { rpe?: number | null; tss?: number | null; durationMin: number }): Intensity {
  if (typeof e.rpe === 'number') {
    if (e.rpe <= 3) return 'recovery';
    if (e.rpe <= 5) return 'endurance';
    if (e.rpe <= 6) return 'tempo';
    if (e.rpe <= 8) return 'threshold';
    return 'vo2';
  }
  if (typeof e.tss === 'number' && e.durationMin > 0) {
    const intensityFactor = Math.sqrt(e.tss / ((e.durationMin / 60) * 100));
    if (intensityFactor < 0.6) return 'recovery';
    if (intensityFactor < 0.76) return 'endurance';
    if (intensityFactor < 0.86) return 'tempo';
    if (intensityFactor < 0.95) return 'threshold';
    return 'vo2';
  }
  return 'endurance';
}
