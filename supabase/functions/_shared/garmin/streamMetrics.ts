/**
 * Per-activity metrics from the watch's per-second samples, ported from
 * camino-703 (`garmin/fitmetrics.py`, David's own system) so both read the
 * same numbers:
 *
 * - normalized power: 30 s rolling mean of power, 4th-power mean, 4th root
 *   (bike, power on more than half of the samples);
 * - intensity factor: NP / FTP (the athlete's FTP at sync time);
 * - best average power over 1, 5, 20 and 60 minutes (the power curve);
 * - aerobic decoupling (Pa:HR / Pw:HR): output per heartbeat in the first vs
 *   the second half of the moving part after a 10-minute warm-up, in %
 *   (positive = the heart worked more for the same output);
 * - heart-rate drift: mean HR of the second half minus the first, ppm.
 *
 * Differences with camino-703: samples are resampled to 1 Hz first (Garmin's
 * "smart recording" writes every 1–5 s; pauses longer than 5 s count once),
 * so the rolling windows are in seconds on every watch, not only on the
 * trainer. Pure.
 */
import type { ActivitySample } from './fit.ts';

export type AnalysedSport = 'run' | 'bike';

export interface StreamMetrics {
  normalizedPowerW?: number;
  intensityFactor?: number;
  bestPower1MinW?: number;
  bestPower5MinW?: number;
  bestPower20MinW?: number;
  bestPower60MinW?: number;
  decouplingPct?: number;
  hrDriftBpm?: number;
}

const MAX_GAP_S = 5;
const WARMUP_S = 600;
/** Moving seconds after the warm-up needed for decoupling and drift (camino-703: > 600 samples). */
const MIN_STEADY_S = 600;
const MIN_RUN_SPEED = 1.2;
const MIN_BIKE_POWER = 30;

interface Second {
  /** Seconds since the first sample. */
  elapsed: number;
  hr?: number;
  powerW?: number;
  speedMps?: number;
}

/** One value per second: a sample is held until the next one (≤ 5 s); a longer gap is a pause and counts once. */
export function resample(samples: readonly ActivitySample[]): Second[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  if (!sorted.length) return [];
  const t0 = sorted[0].t;
  const out: Second[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
    const next = sorted[i + 1];
    const dt = next ? next.t - s.t : 1;
    const copies = dt >= 1 && dt <= MAX_GAP_S ? dt : dt < 1 ? 0 : 1;
    let speed = s.speedMps;
    if (speed === undefined && next && s.distanceM !== undefined && next.distanceM !== undefined && dt > 0 && dt <= MAX_GAP_S) {
      speed = Math.max(0, (next.distanceM - s.distanceM) / dt);
    }
    for (let k = 0; k < copies; k += 1) {
      out.push({ elapsed: s.t - t0 + k, hr: s.hr, powerW: s.powerW, speedMps: speed });
    }
  }
  return out;
}

function rolling(values: readonly number[], n: number): number[] {
  if (values.length < n) return [];
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += values[i];
  const out = [sum / n];
  for (let i = n; i < values.length; i += 1) {
    sum += values[i] - values[i - n];
    out.push(sum / n);
  }
  return out;
}

function best(values: readonly number[], n: number): number | undefined {
  const r = rolling(values, n);
  return r.length ? Math.round(Math.max(...r)) : undefined;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x: number): number => Math.round(x * 10) / 10;

export function normalizedPower(power: readonly number[]): number | undefined {
  const r = rolling(power, 30);
  if (!r.length) return undefined;
  return Math.round(mean(r.map((x) => x ** 4)) ** 0.25);
}

export interface StreamMetricsInput {
  sport: AnalysedSport;
  samples: readonly ActivitySample[];
  ftpW?: number;
}

export function computeStreamMetrics({ sport, samples, ftpW }: StreamMetricsInput): StreamMetrics {
  const secs = resample(samples);
  const out: StreamMetrics = {};
  if (!secs.length) return out;
  const hasPower = secs.filter((s) => s.powerW).length > secs.length * 0.5;

  if (sport === 'bike' && hasPower) {
    const power = secs.map((s) => s.powerW ?? 0);
    const np = normalizedPower(power);
    if (np) {
      out.normalizedPowerW = np;
      if (ftpW && ftpW > 0) out.intensityFactor = Math.round((np / ftpW) * 100) / 100;
    }
    const curve: [keyof StreamMetrics, number][] = [
      ['bestPower1MinW', 60],
      ['bestPower5MinW', 300],
      ['bestPower20MinW', 1200],
      ['bestPower60MinW', 3600],
    ];
    for (const [key, n] of curve) {
      const b = best(power, n);
      if (b !== undefined) out[key] = b;
    }
  }

  // Moving part after the warm-up, with heart rate.
  const steady = secs.filter(
    (s) =>
      s.elapsed >= WARMUP_S &&
      s.hr !== undefined &&
      (sport === 'run' ? (s.speedMps ?? 0) > MIN_RUN_SPEED : hasPower && (s.powerW ?? 0) > MIN_BIKE_POWER),
  );
  if (steady.length > MIN_STEADY_S) {
    const output = (s: Second): number => (sport === 'run' ? (s.speedMps ?? 0) * 60 : s.powerW ?? 0);
    const ratio = (part: readonly Second[]): number => mean(part.map(output)) / mean(part.map((s) => s.hr ?? 0));
    const half = Math.floor(steady.length / 2);
    const first = steady.slice(0, half);
    const second = steady.slice(half);
    const r1 = ratio(first);
    const r2 = ratio(second);
    if (r1 > 0 && r2 > 0) {
      out.decouplingPct = round1(((r1 - r2) / r1) * 100);
      out.hrDriftBpm = round1(mean(second.map((s) => s.hr ?? 0)) - mean(first.map((s) => s.hr ?? 0)));
    }
  }
  return out;
}
