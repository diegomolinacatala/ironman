/**
 * Recovery sparklines (VFC, FC en reposo, sueño) over the last 28 days with
 * source attribution (Garmin / Salud / Manual). Pure.
 */
import { addDays, daysInRange } from '@/domain/dates';
import type { DailyMetrics, DateRange, ISODate, MetricsSource } from '@/domain/types';

import { formatDecimal } from './format';

export const RECOVERY_DAYS = 28;

export type RecoveryKey = 'hrvMs' | 'restingHr' | 'sleepHours';

export interface RecoverySeries {
  key: RecoveryKey;
  label: string;
  unit: string;
  /** One value per day in the window (null = no data). */
  values: (number | null)[];
  dates: ISODate[];
  latest: number | null;
  latestDate: ISODate | null;
  average: number | null;
  /** (latest − average) / average. */
  deltaPct: number | null;
  /** Whether a higher value is generally better (for wording only). */
  higherIsBetter: boolean;
  sources: MetricsSource[];
}

/** Preferred source when a day has several rows. */
const SOURCE_PRIORITY: readonly MetricsSource[] = ['garmin', 'healthkit', 'manual'];

const SPECS: readonly { key: RecoveryKey; label: string; unit: string; higherIsBetter: boolean }[] = [
  { key: 'hrvMs', label: 'VFC', unit: 'ms', higherIsBetter: true },
  { key: 'restingHr', label: 'FC en reposo', unit: 'ppm', higherIsBetter: false },
  { key: 'sleepHours', label: 'Sueño', unit: 'h', higherIsBetter: true },
];

export function recoveryRange(today: ISODate, days = RECOVERY_DAYS): DateRange {
  return { from: addDays(today, -(days - 1)), to: today };
}

export function sourceLabel(source: MetricsSource): string {
  switch (source) {
    case 'garmin':
      return 'Garmin';
    case 'healthkit':
      return 'Salud';
    case 'manual':
      return 'Manual';
  }
}

function pick(rows: readonly DailyMetrics[], key: RecoveryKey): { value: number; source: MetricsSource } | null {
  const sorted = [...rows].sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
  for (const row of sorted) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { value, source: row.source };
  }
  return null;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function buildRecoverySeries(metrics: readonly DailyMetrics[], today: ISODate, days = RECOVERY_DAYS): RecoverySeries[] {
  const dates = daysInRange(recoveryRange(today, days));
  const byDate = new Map<ISODate, DailyMetrics[]>();
  metrics.forEach((m) => byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]));

  return SPECS.map((spec) => {
    const picks = dates.map((d) => pick(byDate.get(d) ?? [], spec.key));
    const values = picks.map((p) => (p ? p.value : null));
    const lastIndex = values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
    const latest = lastIndex >= 0 ? (values[lastIndex] ?? null) : null;
    const average = mean(values.filter((v): v is number => v != null));
    const sources = SOURCE_PRIORITY.filter((s) => picks.some((p) => p?.source === s));
    return {
      ...spec,
      values,
      dates,
      latest,
      latestDate: lastIndex >= 0 ? (dates[lastIndex] ?? null) : null,
      average,
      deltaPct: latest != null && average != null && average > 0 ? (latest - average) / average : null,
      sources,
    };
  });
}

export function formatRecoveryValue(series: Pick<RecoverySeries, 'key'>, value: number): string {
  return series.key === 'sleepHours' ? formatDecimal(value, 1) : `${Math.round(value)}`;
}

/** "+6 % vs. tu media" / "−4 % vs. tu media" / "En tu media". */
export function deltaText(deltaPct: number | null): string | null {
  if (deltaPct == null) return null;
  const pct = Math.round(deltaPct * 100);
  if (pct === 0) return 'En tu media';
  return pct > 0 ? `+${pct} % vs. tu media` : `−${Math.abs(pct)} % vs. tu media`;
}

export function attributionText(series: readonly RecoverySeries[]): string | null {
  const sources = SOURCE_PRIORITY.filter((s) => series.some((x) => x.sources.includes(s)));
  return sources.length > 0 ? `Datos: ${sources.map(sourceLabel).join(' · ')}` : null;
}

export function recoverySummary(series: RecoverySeries): string {
  if (series.latest == null) return `${series.label}: sin datos en los últimos ${RECOVERY_DAYS} días.`;
  const value = `${formatRecoveryValue(series, series.latest)} ${series.unit}`;
  const delta = deltaText(series.deltaPct);
  return `${series.label}: último valor ${value}${delta ? `, ${delta}` : ''}.`;
}
