/**
 * Planned vs done for a completed session, the way a coach reads a watch file:
 * whole-session average HR against the expected range (mirrored zones
 * `sessionHrRange`, warm-up and recoveries included), RPE against
 * `sessionRpe` and the athlete's sensaciones (1–5). One compact Spanish line
 * for the AI coach, Claude and the morning briefing. Pure.
 */
import type { NumberRange, RaceDistance, Thresholds, Workout } from '../types.ts';
import { sessionHrRange, sessionRpe } from './domain/zones.ts';

export type Verdict = 'por debajo' | 'dentro' | 'por encima';

export interface DoneVsPlan {
  hr: { avg: number; expected: NumberRange; verdict: Verdict } | null;
  rpe: { value: number; expected: NumberRange; verdict: Verdict } | null;
  feel: number | null;
  /** "FC media 156 ppm (plan 142–150 ppm: por encima) · RPE 6 (plan 3–4: por encima) · sensaciones 2/5". */
  line: string;
}

export interface ReviewOptions {
  thresholds?: Thresholds | null;
  raceDistance?: RaceDistance | null;
}

/** A watch's average HR is noisy: ±2 ppm around the range still counts as inside. */
const HR_TOLERANCE = 2;

const FEEL_WORDS: Readonly<Record<number, string>> = { 1: 'muy mal', 2: 'mal', 3: 'normal', 4: 'bien', 5: 'genial' };

function verdictOf(value: number, expected: NumberRange, tolerance = 0): Verdict {
  if (value < expected.min - tolerance) return 'por debajo';
  if (value > expected.max + tolerance) return 'por encima';
  return 'dentro';
}

const span = (r: NumberRange): string => (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

const validNumber = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Null for workouts that are not completed or have nothing to compare. */
export function doneVsPlan(w: Workout, opts: ReviewOptions = {}): DoneVsPlan | null {
  const c = w.completed;
  if (w.status !== 'completed' || !c || w.sport === 'rest') return null;
  const zoneOpts = { raceDistance: opts.raceDistance ?? null };
  const avgHr = validNumber(c.avgHr, 30, 230);
  const expectedHr = avgHr === null ? null : sessionHrRange(w, opts.thresholds ?? null, zoneOpts);
  const rpeValue = validNumber(c.rpe, 1, 10);
  const expectedRpe = rpeValue === null ? null : sessionRpe(w, zoneOpts);
  const feel = validNumber(c.feel, 1, 5);
  const hr = avgHr !== null && expectedHr ? { avg: Math.round(avgHr), expected: expectedHr, verdict: verdictOf(avgHr, expectedHr, HR_TOLERANCE) } : null;
  const rpe = rpeValue !== null && expectedRpe ? { value: rpeValue, expected: expectedRpe, verdict: verdictOf(rpeValue, expectedRpe) } : null;
  const parts = [
    hr ? `FC media ${hr.avg} ppm (plan ${span(hr.expected)} ppm: ${hr.verdict})` : avgHr !== null ? `FC media ${Math.round(avgHr)} ppm` : null,
    rpe ? `RPE ${rpe.value} (plan ${span(rpe.expected)}: ${rpe.verdict})` : null,
    feel !== null ? `sensaciones ${feel}/5 (${FEEL_WORDS[Math.round(feel)] ?? 'normal'})` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return { hr, rpe, feel, line: parts.join(' · ') };
}
