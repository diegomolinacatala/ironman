/**
 * Performance-management series for the Progreso hero chart (pure).
 *
 * UI names (TrainingPeaks terms are trademarks): CTL → "Forma física",
 * ATL → "Fatiga", TSB → "Frescura", TSS → "Carga".
 */
import { addDays, daysInRange, diffDays, minDate, startOfWeek } from '@/domain/dates';
import { computePmc, dailyLoads } from '@/domain/load';
import type { DateRange, ISODate, LifeEvent, Workout } from '@/domain/types';

import { formatInt, formatSigned, spokenInt } from './format';

export const DISPLAY_WEEKS = 12;
export const PROJECTION_DAYS = 14;
/** Extra history so the 42-day fitness average is warmed up at the chart start. */
export const WARMUP_DAYS = 56;

export interface PmcPointLike {
  date: ISODate;
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface PmcRanges {
  /** What to fetch (warm-up + display + projection). */
  fetch: DateRange;
  /** What to draw. */
  display: DateRange;
}

export function pmcRanges(today: ISODate): PmcRanges {
  const displayFrom = addDays(startOfWeek(today), -7 * (DISPLAY_WEEKS - 1));
  const to = addDays(today, PROJECTION_DAYS);
  return { fetch: { from: addDays(displayFrom, -WARMUP_DAYS), to }, display: { from: displayFrom, to } };
}

export interface PmcSeries {
  points: PmcPointLike[];
  /** Index of today in `points` (-1 when out of range). */
  todayIndex: number;
  latest: PmcPointLike | null;
  /** Last projected point (end of the planned horizon). */
  projected: PmcPointLike | null;
  /** Fitness change over the last 7 days. */
  rampWeek: number;
  hasData: boolean;
  /** First index with real data (points before it are padding, not drawn). */
  firstIndex: number;
  /** True when the start was estimated because there is little history. */
  seeded: boolean;
}

/** Zero days before the first load that mean "new here", not "on a break". */
export const MIN_HISTORY_DAYS = 42;
const SEED_WINDOW_DAYS = 28;

export interface PmcSeed {
  from: ISODate;
  seed: { ctl: number; atl: number };
}

/**
 * Cold start (docs/research/02 §4.1): with less than 6 weeks of history both
 * averages would start at 0 and read as "huge fatigue". Instead seed
 * CTL = ATL = mean daily load of the first 4 weeks of data, starting there.
 */
export function coldStartSeed(loads: Readonly<Record<ISODate, number>>, fetch: DateRange, today: ISODate): PmcSeed | null {
  const first = daysInRange({ from: fetch.from, to: today }).find((d) => (loads[d] ?? 0) > 0);
  if (!first || diffDays(first, fetch.from) < MIN_HISTORY_DAYS) return null;
  const window = daysInRange({ from: first, to: minDate(addDays(first, SEED_WINDOW_DAYS - 1), today) });
  const avg = window.reduce((sum, d) => sum + (loads[d] ?? 0), 0) / window.length;
  return { from: first, seed: { ctl: avg, atl: avg } };
}

function padding(date: ISODate): PmcPointLike {
  return { date, load: 0, ctl: 0, atl: 0, tsb: 0 };
}

/**
 * Loads: completed (and other sports) up to today, planned sessions after
 * today (dashed projection). Missed past sessions count as 0.
 */
export function buildPmcSeries(input: {
  workouts: readonly Workout[];
  events: readonly LifeEvent[];
  today: ISODate;
}): PmcSeries {
  const { fetch, display } = pmcRanges(input.today);
  const workouts = [...input.workouts];
  const events = [...input.events];
  // Completed load everywhere + planned sessions only after today.
  const loads = dailyLoads(workouts, events, fetch, { includePlanned: true, plannedFrom: addDays(input.today, 1) });
  const cold = coldStartSeed(loads, fetch, input.today);
  const computed: PmcPointLike[] = cold
    ? computePmc(loads, { from: cold.from, to: fetch.to }, cold.seed)
    : computePmc(loads, fetch);
  const byDate = new Map(computed.map((p) => [p.date, p]));
  const points = daysInRange(display).map((d) => byDate.get(d) ?? padding(d));
  const firstIndex = cold ? Math.max(0, points.findIndex((p) => p.date >= cold.from)) : 0;
  const todayIndex = points.findIndex((p) => p.date === input.today);
  const latest = todayIndex >= 0 ? (points[todayIndex] ?? null) : null;
  const weekAgo = byDate.get(addDays(input.today, -7)) ?? computed[0];
  const pastLoad = points.slice(0, todayIndex + 1).reduce((sum, p) => sum + p.load, 0);
  return {
    points,
    todayIndex,
    latest,
    projected: points.length > 0 ? (points[points.length - 1] ?? null) : null,
    rampWeek: latest && weekAgo ? latest.ctl - weekAgo.ctl : 0,
    hasData: pastLoad > 0 || (latest?.ctl ?? 0) >= 1,
    firstIndex,
    seeded: cold !== null,
  };
}

export type FreshnessTone = 'detraining' | 'fresh' | 'neutral' | 'productive' | 'high' | 'risk';

export interface FreshnessReading {
  tone: FreshnessTone;
  text: string;
}

/** One-sentence reading of today's Frescura (thresholds: docs/research/02 §4.3). */
export function interpretFreshness(tsb: number): FreshnessReading {
  const v = Math.round(tsb);
  const head = `Frescura ${formatInt(v)}`;
  if (v > 25) return { tone: 'detraining', text: `${head}: muchos días suaves; si no estás afinando, toca volver a cargar.` };
  if (v > 5) return { tone: 'fresh', text: `${head}: estás fresco, buen momento para competir o para una sesión exigente.` };
  if (v >= -10) return { tone: 'neutral', text: `${head}: zona neutra; mantienes la forma sin acumular fatiga.` };
  if (v >= -20) return { tone: 'productive', text: `${head}: semana cargada, de las que construyen forma; cuida el sueño.` };
  if (v >= -30) return { tone: 'high', text: `${head}: carga alta; no sumes intensidad y prioriza dormir.` };
  return { tone: 'risk', text: `${head}: fatiga muy alta; pide al coach que alivie la semana.` };
}

export function rampText(ramp: number): string {
  const r = Math.round(ramp);
  if (r === 0) return 'Forma física estable esta semana';
  return `Forma física ${formatSigned(r)} en 7 días`;
}

/** Screen-reader summary of the chart. */
export function pmcSummary(series: PmcSeries): string {
  if (!series.latest) return 'Sin datos de carga todavía.';
  const l = series.latest;
  const parts = [
    `Gráfico de las últimas ${DISPLAY_WEEKS} semanas.`,
    `Forma física ${spokenInt(l.ctl)}, ${Math.round(series.rampWeek) >= 0 ? 'sube' : 'baja'} ${Math.abs(Math.round(series.rampWeek))} en 7 días.`,
    `Fatiga ${spokenInt(l.atl)}.`,
    `Frescura ${spokenInt(l.tsb)}.`,
  ];
  if (series.projected && series.projected.date !== l.date) {
    parts.push(
      `Con lo planificado, en ${PROJECTION_DAYS} días: forma física ${spokenInt(series.projected.ctl)}, frescura ${spokenInt(series.projected.tsb)}.`,
    );
  }
  return parts.join(' ');
}
