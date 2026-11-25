/**
 * A completed session against the athlete's similar past sessions: "Eficiencia
 * 6 % mejor que en tus 8 rodajes parecidos". It needs nothing new from the
 * athlete (duration, distance and average HR are already imported), and it is
 * what a coach looks at first: are you faster at the same pulse than before?
 *
 * Similar = same sport, completed in the last year, then narrowed in cascade
 * until at least 3 remain: same intensity and duration ±35 % → same intensity →
 * duration ±35 % → same sport. Ported from the athlete-side report of
 * `camino-703` (report.py), adapted to the data this app has (no FIT streams).
 * Pure.
 */
import { addDays } from './dates';
import type { Intensity, Sport, Workout } from './types';

const LOOKBACK_DAYS = 365;
const MAX_COMPARED = 10;
const MIN_COMPARED = 3;
const DURATION_BAND = 0.35;
/** Below this the difference is noise (GPS, wind, heat): "en tu línea". */
const MEANINGFUL_PCT = 3;

type Comparable = 'run' | 'bike' | 'swim';
const COMPARABLE: readonly Sport[] = ['run', 'bike', 'swim'];

const NOUN: Record<Comparable, string> = { run: 'carreras', bike: 'salidas en bici', swim: 'sesiones de natación' };

const EASY: readonly Intensity[] = ['recovery', 'endurance'];

export interface SimilarComparison {
  /** How many past sessions it was compared with. */
  count: number;
  metric: 'efficiency' | 'speed';
  /** Positive = better than the average of the similar sessions. */
  deltaPct: number;
  /** 1 = the best of all `count + 1` sessions on that metric. */
  rank: number;
  /** One Spanish sentence for the session screen. */
  text: string;
}

interface Measured {
  w: Workout;
  /** Metres per minute. */
  speed: number;
  /** Metres per minute per heart beat (speed / HR), null without HR. */
  efficiency: number | null;
}

function measure(w: Workout): Measured | null {
  const c = w.completed;
  const minutes = c?.durationMin ?? w.durationMin;
  const metres = c?.distanceM ?? null;
  if (!metres || metres <= 0 || !minutes || minutes <= 0) return null;
  const speed = metres / minutes;
  const hr = c?.avgHr;
  return { w, speed, efficiency: typeof hr === 'number' && hr > 40 ? speed / hr : null };
}

function minutesOf(w: Workout): number {
  return w.completed?.durationMin ?? w.durationMin;
}

function withinBand(a: number, b: number): boolean {
  return b > 0 && Math.abs(a - b) / b <= DURATION_BAND;
}

function candidates(target: Workout, history: readonly Workout[]): Measured[] {
  const from = addDays(target.date, -LOOKBACK_DAYS);
  const pool = history
    .filter((w) => w.id !== target.id && w.sport === target.sport && w.status === 'completed' && w.date >= from && w.date <= target.date)
    .map(measure)
    .filter((m): m is Measured => m !== null)
    .sort((a, b) => b.w.date.localeCompare(a.w.date));
  const minutes = minutesOf(target);
  const filters: ((m: Measured) => boolean)[] = [
    (m) => m.w.intensity === target.intensity && withinBand(minutesOf(m.w), minutes),
    (m) => m.w.intensity === target.intensity,
    (m) => withinBand(minutesOf(m.w), minutes),
    () => true,
  ];
  for (const keep of filters) {
    const found = pool.filter(keep);
    if (found.length >= MIN_COMPARED) return found.slice(0, MAX_COMPARED);
  }
  return [];
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Comparison of a completed run, ride or swim with its similar past sessions, or
 * null when there are fewer than 3 or the session has no distance. Easy sessions
 * with HR on both sides compare efficiency (speed per beat); the rest, speed.
 */
export function compareWithSimilar(target: Workout, history: readonly Workout[]): SimilarComparison | null {
  if (target.status !== 'completed' || !COMPARABLE.includes(target.sport)) return null;
  const me = measure(target);
  if (!me) return null;
  const similar = candidates(target, history);
  if (similar.length < MIN_COMPARED) return null;
  const withHr = similar.filter((m) => m.efficiency !== null);
  // Pace in a quality session depends on the set; efficiency is the honest number for easy aerobic work.
  const useEfficiency = me.efficiency !== null && EASY.includes(target.intensity) && withHr.length >= MIN_COMPARED;
  const pick = (m: Measured) => (useEfficiency ? (m.efficiency ?? 0) : m.speed);
  const others = useEfficiency ? withHr : similar;
  const avg = mean(others.map(pick));
  const deltaPct = Math.round(((pick(me) - avg) / avg) * 100);
  const rank = 1 + others.filter((m) => pick(m) > pick(me)).length;
  const noun = NOUN[target.sport as Comparable];
  const what = `tus ${others.length} ${noun} parecidas`;
  const label = useEfficiency ? 'Eficiencia' : 'Ritmo';
  const text =
    Math.abs(deltaPct) < MEANINGFUL_PCT
      ? `${label} en tu línea: igual que la media de ${what}.`
      : deltaPct > 0
        ? `${label} un ${deltaPct} % mejor que la media de ${what}${useEfficiency ? ': más rápido al mismo pulso' : ''}.`
        : `${label} un ${Math.abs(deltaPct)} % peor que la media de ${what}${useEfficiency ? ': calor, cansancio o sensor, merece un vistazo' : ''}.`;
  return { count: others.length, metric: useEfficiency ? 'efficiency' : 'speed', deltaPct, rank, text };
}
