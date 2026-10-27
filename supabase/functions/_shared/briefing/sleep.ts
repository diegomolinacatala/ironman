/**
 * Last night's sleep snapshot for the briefing: the metrics row of `date` (the
 * night that ends that morning) merged field by field preferring Garmin, then
 * Apple Health, then manual entries; HRV compared with the mean of the
 * previous 7 nights. Pure.
 */
import { addDays, localParts } from '../dates.ts';
import { mergeMetricsByDate } from '../planning/wellness.ts';
import type { DailyMetrics, ISODate, SleepSnapshot } from '../types.ts';

/** Nights with HRV needed before a 7-night baseline is meaningful. */
export const MIN_BASELINE_NIGHTS = 3;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number | null | undefined, decimals = 0): number | null => {
  if (!isNum(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Mean HRV (ms, rounded) of the 7 nights before `date`, or null with fewer than 3 nights. */
export function hrvBaseline(merged: readonly DailyMetrics[], date: ISODate): number | null {
  const from = addDays(date, -7);
  const values = merged.filter((m) => m.date >= from && m.date < date).map((m) => m.hrvMs).filter(isNum);
  if (values.length < MIN_BASELINE_NIGHTS) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Snapshot of the night ending on `date`, or null when there is no sleep/recovery data at all. */
export function sleepSnapshot(metrics: readonly DailyMetrics[], date: ISODate): SleepSnapshot | null {
  const merged = mergeMetricsByDate(metrics);
  const night = merged.find((m) => m.date === date);
  if (!night) return null;
  const snapshot: SleepSnapshot = {
    hours: round(night.sleepHours, 2),
    score: round(night.sleepScore),
    deepMin: round(night.sleepDeepMin),
    lightMin: round(night.sleepLightMin),
    remMin: round(night.sleepRemMin),
    awakeMin: round(night.sleepAwakeMin),
    start: night.sleepStart ?? null,
    end: night.sleepEnd ?? null,
    hrvMs: round(night.hrvMs),
    hrvBaselineMs: hrvBaseline(merged, date),
    restingHr: round(night.restingHr),
    bodyBattery: round(night.bodyBattery),
  };
  const { hrvBaselineMs: _baseline, ...measured } = snapshot;
  return Object.values(measured).some((v) => v !== null) ? snapshot : null;
}

/** 7.33 → "7 h 20 min". */
export function formatSleepDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Human, local-time view of the snapshot for the prompt (instants → HH:mm in the athlete's zone). */
export function sleepForPrompt(s: SleepSnapshot | null, tz: string): Record<string, unknown> | null {
  if (!s) return null;
  const hrvDeltaPct = isNum(s.hrvMs) && isNum(s.hrvBaselineMs) && s.hrvBaselineMs > 0
    ? Math.round(((s.hrvMs - s.hrvBaselineMs) / s.hrvBaselineMs) * 100)
    : null;
  return {
    duration: isNum(s.hours) ? formatSleepDuration(s.hours) : null,
    score: s.score,
    stagesMin: { deep: s.deepMin, light: s.lightMin, rem: s.remMin, awake: s.awakeMin },
    bedtime: s.start ? localParts(s.start, tz).time : null,
    wakeTime: s.end ? localParts(s.end, tz).time : null,
    hrvMs: s.hrvMs,
    hrvBaseline7NightsMs: s.hrvBaselineMs,
    hrvVsBaselinePct: hrvDeltaPct,
    restingHr: s.restingHr,
    bodyBattery: s.bodyBattery,
  };
}
