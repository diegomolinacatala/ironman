/** Pure helpers for the v2 Hoy screen: greeting, date line, meals and session structure. Unit-tested. */
import { formatDayLong } from '@/domain/dates';
import type { ISODate, NutritionLog, Workout } from '@/domain/types';
import { stepLabel } from '@/features/workouts/steps';

/** "Buenos días" until 14:00, "Buenas tardes" until 21:00, "Buenas noches" otherwise. */
export function greetingFor(hour: number): string {
  if (hour >= 6 && hour < 14) return 'Buenos días';
  if (hour >= 14 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/** First word of a display name ("Diego Molina" → "Diego"), or null when empty. */
export function firstName(displayName: string | null | undefined): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Buenos días, Diego" (or just "Buenos días" without a name). */
export function greeting(displayName: string | null | undefined, now: Date = new Date()): string {
  const salute = greetingFor(now.getHours());
  const name = firstName(displayName);
  return name ? `${salute}, ${name}` : salute;
}

/** "Martes 27 de octubre". */
export function dateLine(date: ISODate): string {
  const text = formatDayLong(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

/** Entries of `date` in the order they were logged. */
export function mealsOfDay(entries: readonly NutritionLog[] | undefined, date: ISODate): NutritionLog[] {
  return (entries ?? []).filter((e) => e.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface MealTotals {
  count: number;
  /** Null when no entry has the value. */
  kcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0));
}

export function mealTotals(entries: readonly NutritionLog[]): MealTotals {
  return {
    count: entries.length,
    kcal: sumKnown(entries.map((e) => e.kcal)),
    carbsG: sumKnown(entries.map((e) => e.carbsG)),
    proteinG: sumKnown(entries.map((e) => e.proteinG)),
  };
}

/** 1840 → "1.840" (Spanish thousands separator). */
export function formatThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1.840 kcal · 210 g HC · 95 g proteína" (unknown parts omitted; "" when nothing is known). */
export function mealTotalsLine(totals: MealTotals): string {
  const parts: string[] = [];
  if (totals.kcal != null) parts.push(`${formatThousands(totals.kcal)} kcal`);
  if (totals.carbsG != null) parts.push(`${formatThousands(totals.carbsG)} g HC`);
  if (totals.proteinG != null) parts.push(`${formatThousands(totals.proteinG)} g proteína`);
  return parts.join(' · ');
}

/** Screen-reader version of the totals line. */
export function mealTotalsA11y(totals: MealTotals): string {
  const parts: string[] = [];
  if (totals.kcal != null) parts.push(`${totals.kcal} kilocalorías`);
  if (totals.carbsG != null) parts.push(`${totals.carbsG} gramos de hidratos`);
  if (totals.proteinG != null) parts.push(`${totals.proteinG} gramos de proteína`);
  return parts.length > 0 ? `Total de hoy: ${parts.join(', ')}` : '';
}

// ---------------------------------------------------------------------------
// Session structure
// ---------------------------------------------------------------------------

const MAX_STRUCTURE_PARTS = 3;

/** "15' Calentamiento · 6× 4' Trabajo · 10' Vuelta a la calma" (max 3 parts), or null without steps. */
export function structureSummary(workout: Pick<Workout, 'steps' | 'sport'>): string | null {
  if (workout.steps.length === 0) return null;
  const labels = workout.steps.map((s) => stepLabel(s, workout.sport).replace(' · ', ' '));
  const shown = labels.slice(0, MAX_STRUCTURE_PARTS).join(' · ');
  const rest = labels.length - MAX_STRUCTURE_PARTS;
  return rest > 0 ? `${shown} · +${rest}` : shown;
}
