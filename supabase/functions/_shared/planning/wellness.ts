/**
 * Compact wellness signals for Claude (docs/research/02 §11.8): latest values
 * versus the athlete's own recent baseline. Descriptive only — never a
 * diagnosis.
 */
import type { DailyCheckin, DailyMetrics, ISODate } from '../types.ts';

export interface WellnessSignals {
  latestDate: ISODate | null;
  signals: string[];
  level: 'green' | 'amber' | 'red' | 'unknown';
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

function numbers(rows: readonly DailyMetrics[], pick: (m: DailyMetrics) => number | null): number[] {
  return rows.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** One row per date, preferring Garmin over other sources field by field. */
export function mergeMetricsByDate(rows: readonly DailyMetrics[]): DailyMetrics[] {
  const rank = { garmin: 0, healthkit: 1, manual: 2 } as const;
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || rank[a.source] - rank[b.source]);
  const byDate = new Map<ISODate, DailyMetrics>();
  for (const row of sorted) {
    const prev = byDate.get(row.date);
    if (!prev) {
      byDate.set(row.date, row);
      continue;
    }
    const a = prev as unknown as Record<string, unknown>;
    const b = row as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const merged = Object.fromEntries([...keys].map((k) => [k, a[k] ?? b[k] ?? null])) as unknown as DailyMetrics;
    byDate.set(row.date, merged);
  }
  return [...byDate.values()];
}

export function wellnessSignals(metrics: readonly DailyMetrics[], checkins: readonly DailyCheckin[]): WellnessSignals {
  const merged = mergeMetricsByDate(metrics);
  const latest = merged[merged.length - 1] ?? null;
  const lastCheckin = [...checkins].sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;
  const signals: string[] = [];
  let amber = 0;
  let red = 0;
  if (latest) {
    const baseline = merged.slice(0, -1);
    const hrvMean = mean(numbers(baseline, (m) => m.hrvMs));
    if (latest.hrvMs != null && hrvMean) {
      const pct = Math.round(((latest.hrvMs - hrvMean) / hrvMean) * 100);
      if (pct <= -10) {
        signals.push(`VFC ${latest.hrvMs} ms, ${Math.abs(pct)} % por debajo de su media reciente`);
        amber += 1;
      }
    }
    const rhrMean = mean(numbers(baseline, (m) => m.restingHr));
    if (latest.restingHr != null && rhrMean) {
      const delta = Math.round(latest.restingHr - rhrMean);
      if (delta >= 8) red += 1;
      if (delta >= 5) signals.push(`FC en reposo +${delta} lpm sobre su media`);
      if (delta >= 5 && delta < 8) amber += 1;
    }
    if (latest.sleepHours != null && latest.sleepHours < 6) {
      signals.push(`Durmió ${latest.sleepHours.toFixed(1).replace('.', ',')} h`);
      amber += 1;
    }
    if (latest.trainingReadiness != null && latest.trainingReadiness < 50) {
      signals.push(`Training Readiness de Garmin ${latest.trainingReadiness}`);
      if (latest.trainingReadiness < 25) red += 1;
      else amber += 1;
    }
    if (latest.bodyBattery != null && latest.bodyBattery < 30) signals.push(`Body Battery bajo (${latest.bodyBattery})`);
  }
  if (lastCheckin) {
    if (lastCheckin.fatigue >= 5) red += 1;
    else if (lastCheckin.fatigue >= 4 || lastCheckin.soreness >= 4) amber += 1;
    if (lastCheckin.fatigue >= 4) signals.push(`Fatiga subjetiva ${lastCheckin.fatigue}/5 (${lastCheckin.date})`);
    if (lastCheckin.soreness >= 4) signals.push(`Agujetas/dolor muscular ${lastCheckin.soreness}/5`);
    if (lastCheckin.stress >= 4) signals.push(`Estrés ${lastCheckin.stress}/5`);
  }
  const level = !latest && !lastCheckin ? 'unknown' : red > 0 ? 'red' : amber >= 2 ? 'amber' : 'green';
  return { latestDate: latest?.date ?? lastCheckin?.date ?? null, signals, level };
}
