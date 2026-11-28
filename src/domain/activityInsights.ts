/**
 * What the watch's per-second data says about a completed session, in one or
 * two quiet sentences for the workout detail (the numbers are computed on the
 * Garmin sync from the FIT file: supabase/functions/_shared/garmin/streamMetrics.ts).
 *
 * - Decoupling and heart-rate drift only on runs and rides of ≥ 45 min: on a
 *   short or interval session they say little.
 * - Normalized power, IF and the best 1 / 5 / 20 / 60-minute power on rides.
 *
 * Pure; empty when the session has none of these numbers. The rules analysis
 * (workoutAnalysis.ts) reuses the decoupling sentence.
 */
import type { Workout } from './types';

const MIN_DECOUPLING_MIN = 45;
/** Coggan / Friel: under 5 % the aerobic base holds the effort. */
const DECOUPLING_THRESHOLD = 5;

const pct = (x: number): string => `${Math.round(Math.abs(x))} %`;
const decimal = (x: number): string => x.toFixed(2).replace('.', ',');

export interface DecouplingInsight {
  /** 'warn': the heart worked more in the second half; 'good': steady or more efficient. */
  tone: 'good' | 'warn';
  text: string;
}

/** The decoupling sentence of a long run or ride (≥ 45 min), or null. Also used by the rules analysis. */
export function decouplingInsight(w: Workout): DecouplingInsight | null {
  const c = w.completed;
  const d = c?.decouplingPct;
  if (d === undefined || (w.sport !== 'run' && w.sport !== 'bike')) return null;
  if ((c?.durationMin ?? w.durationMin) < MIN_DECOUPLING_MIN) return null;
  const drift = Math.round(c?.hrDriftBpm ?? 0);
  if (d >= DECOUPLING_THRESHOLD) {
    const cause = 'Suele ser calor, poca hidratación o falta de base aeróbica.';
    const text =
      drift >= 2
        ? `En la segunda mitad tu pulso subió ${drift} ppm y rendiste un ${pct(d)} menos por latido. ${cause}`
        : `En la segunda mitad rendiste un ${pct(d)} menos por latido. ${cause}`;
    return { tone: 'warn', text };
  }
  if (d <= -DECOUPLING_THRESHOLD) return { tone: 'good', text: `Terminaste más eficiente de lo que empezaste (un ${pct(d)} más por latido): saliste con calma.` };
  return { tone: 'good', text: `Pulso estable en la segunda mitad (desacople del ${pct(d)}): buena señal de base aeróbica.` };
}

function powerLines(w: Workout): string[] {
  const c = w.completed;
  if (!c || w.sport !== 'bike') return [];
  const lines: string[] = [];
  if (c.normalizedPowerW !== undefined) {
    lines.push(`Potencia normalizada ${c.normalizedPowerW} W${c.intensityFactor !== undefined ? ` · IF ${decimal(c.intensityFactor)}` : ''}.`);
  }
  const curve: [string, number | undefined][] = [
    ['1 min', c.bestPower1MinW],
    ['5 min', c.bestPower5MinW],
    ['20 min', c.bestPower20MinW],
    ['60 min', c.bestPower60MinW],
  ];
  const bests = curve.filter((b): b is [string, number] => b[1] !== undefined);
  // Only with the file's curve: the 1 and 20-minute bests alone are already Garmin's summary.
  if (c.analyzedAt && bests.length >= 2) lines.push(`Mejor potencia: ${bests.map(([label, v]) => `${label} ${v} W`).join(' · ')}.`);
  return lines;
}

export function activityInsights(w: Workout): string[] {
  if (w.status !== 'completed') return [];
  const decoupling = decouplingInsight(w);
  return [...(decoupling ? [decoupling.text] : []), ...powerLines(w)];
}
