/**
 * Nutrition log helpers: grouping, totals, inline form validation and which
 * sessions deserve fueling tips (pure).
 */
import { MEAL_SLOTS, type ISODate, type MealSlot, type NutritionDraft, type NutritionLog, type Workout } from '@/domain/types';
import { firstError, nutritionDraftSchema } from '@/domain/validation';

export interface SlotGroup {
  slot: MealSlot;
  entries: NutritionLog[];
}

export function groupBySlot(logs: readonly NutritionLog[]): SlotGroup[] {
  return MEAL_SLOTS.map((slot) => ({
    slot,
    entries: logs.filter((l) => l.meal === slot).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  })).filter((g) => g.entries.length > 0);
}

export interface DayTotals {
  kcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  hasMacros: boolean;
}

export function dayTotals(logs: readonly NutritionLog[]): DayTotals {
  const sum = (pick: (l: NutritionLog) => number | null) => logs.reduce((acc, l) => acc + (pick(l) ?? 0), 0);
  const hasMacros = logs.some((l) => l.kcal != null || l.carbsG != null || l.proteinG != null || l.fatG != null);
  return {
    kcal: sum((l) => l.kcal),
    carbsG: sum((l) => l.carbsG),
    proteinG: sum((l) => l.proteinG),
    fatG: sum((l) => l.fatG),
    hasMacros,
  };
}

/** Sensible slot for "now" (24 h clock). */
export function defaultSlot(hour: number): MealSlot {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 20) return 'snack';
  return 'dinner';
}

export interface NutritionFormState {
  meal: MealSlot;
  description: string;
  kcal: string;
  carbsG: string;
  proteinG: string;
  fatG: string;
}

export function emptyNutritionForm(meal: MealSlot): NutritionFormState {
  return { meal, description: '', kcal: '', carbsG: '', proteinG: '', fatG: '' };
}

/** '' → null, '12,5' → 12.5, garbage → NaN (caught by validation). */
export function parseOptionalNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const NUMBER_FIELDS: readonly { key: 'kcal' | 'carbsG' | 'proteinG' | 'fatG'; label: string }[] = [
  { key: 'kcal', label: 'Kcal' },
  { key: 'carbsG', label: 'Hidratos' },
  { key: 'proteinG', label: 'Proteína' },
  { key: 'fatG', label: 'Grasa' },
];

export type NutritionValidation = { ok: true; draft: NutritionDraft } | { ok: false; error: string };

export function validateNutritionForm(state: NutritionFormState, date: ISODate): NutritionValidation {
  const invalid = NUMBER_FIELDS.find((f) => Number.isNaN(parseOptionalNumber(state[f.key])));
  if (invalid) return { ok: false, error: `${invalid.label}: escribe un número, por ejemplo 45.` };
  // The schema stores whole grams / kcal: round what the user typed.
  const whole = (text: string): number | null => {
    const n = parseOptionalNumber(text);
    return n == null ? null : Math.round(n);
  };
  const draft: NutritionDraft = {
    date,
    meal: state.meal,
    description: state.description.trim(),
    kcal: whole(state.kcal),
    carbsG: whole(state.carbsG),
    proteinG: whole(state.proteinG),
    fatG: whole(state.fatG),
  };
  if (draft.description.length === 0) return { ok: false, error: 'Describe lo que has comido.' };
  const result = nutritionDraftSchema.safeParse(draft);
  if (!result.success) return { ok: false, error: firstError(result) ?? 'Revisa los datos.' };
  return { ok: true, draft };
}

const NO_FUEL: ReadonlySet<Workout['sport']> = new Set(['rest', 'mobility']);
const MAX_TIPS = 3;

/** Sessions of the day worth fueling advice: key first, then longest. */
export function fuelingSessions(workouts: readonly Workout[], date: ISODate): Workout[] {
  return workouts
    .filter((w) => w.date === date && !NO_FUEL.has(w.sport) && w.status !== 'skipped' && w.durationMin > 0)
    .sort((a, b) => Number(b.isKey) - Number(a.isKey) || b.durationMin - a.durationMin)
    .slice(0, MAX_TIPS);
}
