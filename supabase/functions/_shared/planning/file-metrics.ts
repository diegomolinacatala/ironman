/**
 * What the watch's FIT file added to a completed session (garmin/analysis.ts),
 * as the AI coach, the briefing, the post-workout analysis and Claude read it:
 * only the numbers it has, under `fromFile` so the prompts can describe them
 * in one place. Absent when the file was not analysed or had nothing.
 */
import type { CompletedData } from '../types.ts';

export interface FileMetricsView {
  /** Aerobic decoupling, %: > 5 on a long steady session = the heart worked more for the same output. */
  decouplingPct?: number;
  /** Mean HR of the second half minus the first, ppm. */
  hrDriftBpm?: number;
  normalizedPowerW?: number;
  /** NP / FTP. */
  intensityFactor?: number;
  bestPower1MinW?: number;
  bestPower5MinW?: number;
  bestPower20MinW?: number;
  bestPower60MinW?: number;
}

const KEYS = [
  'decouplingPct',
  'hrDriftBpm',
  'normalizedPowerW',
  'intensityFactor',
  'bestPower1MinW',
  'bestPower5MinW',
  'bestPower20MinW',
  'bestPower60MinW',
] as const satisfies readonly (keyof FileMetricsView & keyof CompletedData)[];

export function fileMetricsOf(c: CompletedData | null | undefined): { fromFile?: FileMetricsView } {
  if (!c?.analyzedAt) return {};
  const view: FileMetricsView = {};
  for (const k of KEYS) {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) view[k] = v;
  }
  return Object.keys(view).length ? { fromFile: view } : {};
}
