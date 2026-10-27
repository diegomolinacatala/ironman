/**
 * Meal result form ↔ `MealAnalysis` / `NutritionDraft` (pure). The form is the
 * nutrition log form (strings, so fields can be empty while editing); saving
 * goes through the same validation as the manual entry.
 */
import { minutesToTime } from '@/domain/dates';
import type { ISODate, ISOTime, MealAnalysis, MealAnalysisInput, MealSlot } from '@/domain/types';
import { emptyNutritionForm, parseOptionalNumber, type NutritionFormState } from '@/features/nutrition/nutritionModel';
import type { MealPhoto } from '@/integrations/camera/mealPhoto';

export type MacroKey = 'kcal' | 'carbsG' | 'proteinG' | 'fatG';

export interface MacroField {
  key: MacroKey;
  label: string;
  unit: string;
  /** Upper bound accepted by the nutrition schema. */
  max: number;
}

export const MACRO_FIELDS: readonly MacroField[] = [
  { key: 'kcal', label: 'Kcal', unit: 'kcal', max: 10_000 },
  { key: 'carbsG', label: 'HC', unit: 'g', max: 2000 },
  { key: 'proteinG', label: 'Proteína', unit: 'g', max: 1000 },
  { key: 'fatG', label: 'Grasa', unit: 'g', max: 1000 },
];

/** Max length of the text sent for analysis (the description field accepts more). */
export const MAX_MEAL_TEXT = 500;

function numberText(value: number | null): string {
  return value != null && Number.isFinite(value) && value >= 0 ? String(Math.round(value)) : '';
}

/** Editable form prefilled with the estimate. */
export function formFromAnalysis(analysis: MealAnalysis): NutritionFormState {
  return {
    meal: analysis.meal,
    description: analysis.description.trim(),
    kcal: numberText(analysis.kcal),
    carbsG: numberText(analysis.carbsG),
    proteinG: numberText(analysis.proteinG),
    fatG: numberText(analysis.fatG),
  };
}

/** Empty form for manual entry, keeping what the athlete already described. */
export function manualForm(meal: MealSlot, description: string): NutritionFormState {
  return { ...emptyNutritionForm(meal), description: description.trim() };
}

/** "HH:MM" of `now` (local). */
export function mealTime(now: Date = new Date()): ISOTime {
  return minutesToTime(now.getHours() * 60 + now.getMinutes());
}

/** What goes to `analyzeMeal`: photo and/or description (one of them at least). */
export function analysisInput(input: { photo: MealPhoto | null; text: string; date: ISODate; now?: Date }): MealAnalysisInput | null {
  const text = input.text.trim().slice(0, MAX_MEAL_TEXT);
  if (!input.photo && text.length === 0) return null;
  return {
    date: input.date,
    time: mealTime(input.now),
    ...(input.photo ? { imageBase64: input.photo.base64 } : {}),
    ...(text ? { text } : {}),
  };
}

export function confidenceHint(confidence: MealAnalysis['confidence']): string | null {
  return confidence === 'low' ? 'Estimación aproximada: revisa las cantidades antes de guardar.' : null;
}

/** ± buttons of a macro field: empty counts as 0, never below 0 or above `max`. */
export function stepMacro(text: string, delta: number, max: number): string {
  const current = parseOptionalNumber(text);
  const base = current == null || Number.isNaN(current) ? 0 : current;
  return String(Math.min(max, Math.max(0, Math.round(base + delta))));
}

/** Step of the ± buttons for each macro. */
export function macroStep(key: MacroKey): number {
  return key === 'kcal' ? 50 : 5;
}
