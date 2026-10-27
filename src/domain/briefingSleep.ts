/**
 * Last night's sleep for the morning briefing: per-field merge of every
 * metrics source (Garmin → HealthKit → manual), the 7-night HRV baseline and
 * a simple verdict. Pure.
 */
import { addDays } from './dates';
import type { DailyMetrics, ISODate, MetricsSource, SleepSnapshot, SleepVerdict } from './types';

const SOURCE_PRIORITY: readonly MetricsSource[] = ['garmin', 'healthkit', 'manual'];
const BASELINE_NIGHTS = 7;
/** Fewer nights than this is not a baseline. */
const BASELINE_MIN_NIGHTS = 3;
const BASELINE_LOOKBACK_DAYS = 28;
/** HRV below this share of the baseline lowers the verdict / is called out. */
export const HRV_LOW_RATIO = 0.9;
/** HRV above this share of the baseline is called out as high. */
export const HRV_HIGH_RATIO = 1.1;

export function isNum(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function rowsOf(metrics: readonly DailyMetrics[], date: ISODate): DailyMetrics[] {
  const rank = (m: DailyMetrics): number => {
    const i = SOURCE_PRIORITY.indexOf(m.source);
    return i < 0 ? SOURCE_PRIORITY.length : i;
  };
  return metrics.filter((m) => m.date === date).sort((a, b) => rank(a) - rank(b));
}

/** First non-null value of a field across sources (garmin → healthkit → manual). */
function merged<T>(rows: readonly DailyMetrics[], read: (m: DailyMetrics) => T | null | undefined): T | null {
  const found = rows.map(read).find((v) => v !== null && v !== undefined && (typeof v !== 'number' || Number.isFinite(v)));
  return found ?? null;
}

function hrvBaseline(metrics: readonly DailyMetrics[], date: ISODate): number | null {
  const from = addDays(date, -BASELINE_LOOKBACK_DAYS);
  const dates = [...new Set(metrics.filter((m) => m.date < date && m.date >= from).map((m) => m.date))].sort().reverse();
  const values = dates
    .map((d) => merged(rowsOf(metrics, d), (m) => m.hrvMs))
    .filter(isNum)
    .slice(0, BASELINE_NIGHTS);
  if (values.length < BASELINE_MIN_NIGHTS) return null;
  return round(values.reduce((sum, v) => sum + v, 0) / values.length, 1);
}

function hoursFrom(rows: readonly DailyMetrics[]): number | null {
  const hours = merged(rows, (m) => m.sleepHours);
  if (hours !== null) return hours;
  const deep = merged(rows, (m) => m.sleepDeepMin);
  const light = merged(rows, (m) => m.sleepLightMin);
  const rem = merged(rows, (m) => m.sleepRemMin);
  return isNum(deep) && isNum(light) && isNum(rem) ? round((deep + light + rem) / 60, 2) : null;
}

/** Last night's sleep (the night that ends on `date`), merged per field; null without any data. */
export function sleepSnapshotFrom(metrics: readonly DailyMetrics[], date: ISODate): SleepSnapshot | null {
  const rows = rowsOf(metrics, date);
  if (rows.length === 0) return null;
  const snapshot: SleepSnapshot = {
    hours: hoursFrom(rows),
    score: merged(rows, (m) => m.sleepScore),
    deepMin: merged(rows, (m) => m.sleepDeepMin),
    lightMin: merged(rows, (m) => m.sleepLightMin),
    remMin: merged(rows, (m) => m.sleepRemMin),
    awakeMin: merged(rows, (m) => m.sleepAwakeMin),
    start: merged(rows, (m) => m.sleepStart),
    end: merged(rows, (m) => m.sleepEnd),
    hrvMs: merged(rows, (m) => m.hrvMs),
    hrvBaselineMs: hrvBaseline(metrics, date),
    restingHr: merged(rows, (m) => m.restingHr),
    bodyBattery: merged(rows, (m) => m.bodyBattery),
  };
  const { hours, score, deepMin, hrvMs, restingHr, bodyBattery } = snapshot;
  return [hours, score, deepMin, hrvMs, restingHr, bodyBattery].some(isNum) ? snapshot : null;
}

const VERDICT_ORDER: readonly SleepVerdict[] = ['poor', 'fair', 'good', 'great'];

/** Last night's HRV over the baseline, or null without both. */
export function hrvRatio(s: SleepSnapshot): number | null {
  return isNum(s.hrvMs) && isNum(s.hrvBaselineMs) && s.hrvBaselineMs > 0 ? s.hrvMs / s.hrvBaselineMs : null;
}

/** Garmin's sleep score bands: 90+ excellent, 80+ good, 60+ fair, below poor. */
function verdictFromScore(score: number): SleepVerdict {
  if (score >= 90) return 'great';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

function verdictFromHours(hours: number): SleepVerdict {
  if (hours >= 8) return 'great';
  if (hours >= 7) return 'good';
  if (hours >= 6) return 'fair';
  return 'poor';
}

/** Sleep score first; otherwise hours, one step lower when HRV is clearly below baseline. */
export function sleepVerdictOf(s: SleepSnapshot | null): SleepVerdict {
  if (!s) return 'unknown';
  if (isNum(s.score)) return verdictFromScore(s.score);
  const ratio = hrvRatio(s);
  if (!isNum(s.hours)) {
    if (ratio === null) return 'unknown';
    return ratio >= 0.95 ? 'good' : ratio >= 0.85 ? 'fair' : 'poor';
  }
  const base = verdictFromHours(s.hours);
  if (ratio === null || ratio >= HRV_LOW_RATIO) return base;
  return VERDICT_ORDER[Math.max(0, VERDICT_ORDER.indexOf(base) - 1)] ?? base;
}
