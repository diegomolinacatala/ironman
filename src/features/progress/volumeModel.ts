/**
 * Weekly volume (by sport) and compliance series for Progreso (pure).
 */
import { addDays, startOfWeek } from '@/domain/dates';
import { weekSummary } from '@/domain/load';
import type { ISODate, Sport, Workout } from '@/domain/types';

import { formatDayMonth, formatHours } from './format';

/** Stacking order, bottom → top. */
export const SPORT_ORDER: readonly Sport[] = ['swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other'];

export interface SportMinutes {
  sport: Sport;
  minutes: number;
}

export interface VolumeWeek {
  weekStart: ISODate;
  label: string;
  isCurrent: boolean;
  plannedMin: number;
  completedMin: number;
  /** Completed minutes per sport, in SPORT_ORDER. */
  bySport: SportMinutes[];
  compliancePct: number | null;
}

function weekStarts(today: ISODate, count: number): ISODate[] {
  const current = startOfWeek(today);
  return Array.from({ length: count }, (_, i) => addDays(current, -7 * (count - 1 - i)));
}

export function buildVolumeWeeks(workouts: readonly Workout[], today: ISODate, count = 8): VolumeWeek[] {
  const list = [...workouts];
  const current = startOfWeek(today);
  return weekStarts(today, count).map((ws) => {
    const s = weekSummary(list, ws, today);
    const bySport = SPORT_ORDER.flatMap((sport) => {
      const minutes = s.bySport[sport]?.completedMin ?? 0;
      return minutes > 0 ? [{ sport, minutes }] : [];
    });
    return {
      weekStart: ws,
      label: formatDayMonth(ws),
      isCurrent: ws === current,
      plannedMin: s.plannedMin,
      completedMin: s.completedMin,
      bySport,
      compliancePct: s.compliancePct,
    };
  });
}

/** Sports that appear in any week (for the legend). */
export function sportsInWeeks(weeks: readonly VolumeWeek[]): Sport[] {
  const present = new Set(weeks.flatMap((w) => w.bySport.map((b) => b.sport)));
  return SPORT_ORDER.filter((s) => present.has(s));
}

export function maxWeekMinutes(weeks: readonly VolumeWeek[]): number {
  return weeks.reduce((max, w) => Math.max(max, w.plannedMin, w.completedMin), 0);
}

export function volumeSummary(weeks: readonly VolumeWeek[]): string {
  const current = weeks.find((w) => w.isCurrent);
  if (!current) return 'Sin datos de volumen.';
  const done = weeks.filter((w) => !w.isCurrent);
  const avg = done.length > 0 ? done.reduce((sum, w) => sum + w.completedMin, 0) / done.length : 0;
  return [
    `Volumen semanal de las últimas ${weeks.length} semanas.`,
    `Esta semana llevas ${formatHours(current.completedMin)} de ${formatHours(current.plannedMin)} planificadas.`,
    done.length > 0 ? `Media de las semanas anteriores: ${formatHours(avg)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export type ComplianceBand = 'done' | 'partial' | 'off';

/** Week-level compliance band (TrainingPeaks-style: ≥80 % done, ≥50 % partial). */
export function complianceBand(pct: number): ComplianceBand {
  if (pct >= 0.8) return 'done';
  if (pct >= 0.5) return 'partial';
  return 'off';
}

export function complianceBandLabel(band: ComplianceBand): string {
  switch (band) {
    case 'done':
      return 'Cumplida';
    case 'partial':
      return 'Desviada';
    case 'off':
      return 'Muy desviada';
  }
}
