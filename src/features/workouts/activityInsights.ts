/**
 * What the watch's per-second data says about a completed session, in one or
 * two quiet sentences for the workout detail (the numbers are computed on the
 * Garmin sync from the FIT file: supabase/functions/_shared/garmin/streamMetrics.ts).
 *
 * - Decoupling and heart-rate drift only on runs and rides of ≥ 45 min: on a
 *   short or interval session they say little.
 * - Normalized power, IF and the best 1 / 5 / 20 / 60-minute power on rides.
 *
 * Pure; empty when the session has none of these numbers.
 */
import type { Workout } from '@/domain/types';

const MIN_DECOUPLING_MIN = 45;
/** Coggan / Friel: under 5 % the aerobic base holds the effort. */
const DECOUPLING_THRESHOLD = 5;

const pct = (x: number): string => `${Math.round(Math.abs(x))} %`;
const decimal = (x: number): string => x.toFixed(2).replace('.', ',');

function decouplingLine(w: Workout): string | null {
  const c = w.completed;
  const d = c?.decouplingPct;
  if (d === undefined || (w.sport !== 'run' && w.sport !== 'bike')) return null;
  if ((c?.durationMin ?? w.durationMin) < MIN_DECOUPLING_MIN) return null;
  const drift = Math.round(c?.hrDriftBpm ?? 0);
  if (d >= DECOUPLING_THRESHOLD) {
    const cause = 'Suele ser calor, poca hidratación o falta de base aeróbica.';
    return drift >= 2
      ? `En la segunda mitad tu pulso subió ${drift} ppm y rendiste un ${pct(d)} menos por latido. ${cause}`
      : `En la segunda mitad rendiste un ${pct(d)} menos por latido. ${cause}`;
  }
  if (d <= -DECOUPLING_THRESHOLD) return `Terminaste más eficiente de lo que empezaste (un ${pct(d)} más por latido): saliste con calma.`;
  return `Pulso estable en la segunda mitad (desacople del ${pct(d)}): buena señal de base aeróbica.`;
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
  return [decouplingLine(w), ...powerLines(w)].filter((l): l is string => l !== null);
}
