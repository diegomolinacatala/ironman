/**
 * One-line summaries for the closed folds of Progreso (DESIGN §4b: a closed fold
 * still says what is inside). They carry the number, so the tab answers "how am
 * I doing?" without opening anything. Pure.
 */
import type { DayTotals } from '@/features/nutrition/nutritionModel';

import { formatHours, formatInt, formatSigned } from './format';
import type { PmcSeries } from './pmcModel';
import { formatRecoveryValue, type RecoverySeries } from './recoveryModel';
import type { VolumeWeek } from './volumeModel';

/** "Forma 42 · frescura −8" (fallback: what the fold holds). */
export function formFoldSummary(pmc: PmcSeries | null): string {
  const latest = pmc?.hasData ? pmc.latest : null;
  if (!latest) return 'Forma física, fatiga y frescura';
  return `Forma ${formatInt(Math.round(latest.ctl))} · frescura ${formatSigned(Math.round(latest.tsb))}`;
}

/** "Esta semana 3 h 20' de 6 h · 80 %". */
export function volumeFoldSummary(weeks: readonly VolumeWeek[]): string {
  const current = weeks.find((w) => w.isCurrent);
  if (!current) return 'Horas por semana y lo que has cumplido';
  const pct = current.compliancePct != null ? ` · ${Math.round(current.compliancePct * 100)} %` : '';
  const planned = current.plannedMin > 0 ? ` de ${formatHours(current.plannedMin)}` : '';
  return `Esta semana ${formatHours(current.completedMin)}${planned}${pct}`;
}

/** "VFC 62 ms · FC en reposo 48 ppm · Sueño 7,2 h" with the latest values present. */
export function recoveryFoldSummary(series: readonly RecoverySeries[]): string {
  const parts = series.flatMap((s) => (s.latest == null ? [] : [`${s.label} ${formatRecoveryValue(s, s.latest)} ${s.unit}`]));
  return parts.length > 0 ? parts.join(' · ') : 'Conecta tu reloj para ver VFC, pulso y sueño';
}

/** "1850 kcal · 230 g de hidratos" / "2 comidas apuntadas" / "Nada apuntado hoy". */
export function nutritionFoldSummary(nutrition: { totals: DayTotals; entries: number } | null): string {
  if (!nutrition || nutrition.entries === 0) return 'Nada apuntado hoy';
  const { totals } = nutrition;
  if (totals.hasMacros && totals.kcal > 0) {
    const kcal = String(Math.round(totals.kcal));
    return totals.carbsG > 0 ? `${kcal} kcal · ${Math.round(totals.carbsG)} g de hidratos` : `${kcal} kcal`;
  }
  return nutrition.entries === 1 ? '1 comida apuntada' : `${nutrition.entries} comidas apuntadas`;
}
