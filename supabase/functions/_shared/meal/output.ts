/**
 * Structured output of the meal analysis: strict JSON Schema for Claude, then a
 * defensive normalization (sane integer macros or null, short items, slot
 * guessed from the time when the model's is unusable) → app `MealAnalysis`.
 */
import { clipWords, plainText } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import { array, enumOf, integer, nullable, object, string, toStructuredOutputSchema } from '../schema.ts';
import { MEAL_SLOTS } from '../types.ts';
import type { ISOTime, MealAnalysis, MealSlot } from '../types.ts';

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const MAX_ITEMS = 12;
export const ITEM_MAX = 80;
export const DESCRIPTION_MAX = 120;
export const TIP_MAX = 140;

/** Upper bounds for one meal; anything above is treated as unknown. */
export const MACRO_LIMITS = { kcal: 4000, carbsG: 600, proteinG: 300, fatG: 300 } as const;

const outputSchema = object({
  meal: enumOf(MEAL_SLOTS, 'Franja: breakfast, lunch, dinner, snack, pre (antes de entrenar), during, post (después).'),
  description: string({ min: 1, description: 'Descripción corta en español.' }),
  items: array(string(), { description: 'Alimentos reconocidos con su ración aproximada ("Pasta cocida · 250 g").' }),
  kcal: nullable(integer()),
  carbs_g: nullable(integer()),
  protein_g: nullable(integer()),
  fat_g: nullable(integer()),
  confidence: enumOf(CONFIDENCES),
  tip: nullable(string({ description: 'Consejo ligado al entreno de hoy (máximo 140 caracteres) o null.' })),
});

export const MEAL_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(outputSchema.json) as Record<string, unknown>;

/** Spanish meal times: breakfast before 11:00, lunch 13:30–16:30, dinner from 20:00, snacks in between. */
export function mealSlotFromTime(time: ISOTime): MealSlot {
  const [h, m] = time.split(':').map(Number);
  const min = h * 60 + m;
  if (min >= 5 * 60 && min < 11 * 60) return 'breakfast';
  if (min >= 13 * 60 + 30 && min < 16 * 60 + 30) return 'lunch';
  if (min >= 20 * 60) return 'dinner';
  return 'snack';
}

/** Integer in [0, max] (rounded), else null. */
function macro(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 0 && n <= max ? n : null;
}

/** Open models sometimes write "°" for the "·" separator of the examples ("Pasta cocida ° 250 g"). */
const fixSeparator = (s: string): string => s.replace(/\s+°\s+/g, ' · ');

function items(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i): i is string => typeof i === 'string')
    .map((i) => clipWords(plainText(fixSeparator(i)), ITEM_MAX))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;

/** Above this relative gap between kcal and 4·HC + 4·P + 9·G the numbers don't add up. */
export const MACRO_MISMATCH = 0.35;

/** True when the model's kcal and macros clearly contradict each other (e.g. food weight given as carbs). */
export function macrosMismatch(kcal: number | null, fromMacros: number | null): boolean {
  if (kcal === null || fromMacros === null || kcal === 0) return false;
  return Math.abs(fromMacros - kcal) / kcal > MACRO_MISMATCH;
}

/** Model JSON → MealAnalysis. Throws `bad_output` only when there is no description at all. */
export function toMealAnalysis(raw: Record<string, unknown>, time: ISOTime): MealAnalysis {
  const description = typeof raw.description === 'string' ? clipWords(plainText(raw.description), DESCRIPTION_MAX) : '';
  if (!description) throw new CoachAiError('bad_output', 'El análisis de la comida no tenía el formato esperado.');
  const carbsG = macro(raw.carbs_g, MACRO_LIMITS.carbsG);
  const proteinG = macro(raw.protein_g, MACRO_LIMITS.proteinG);
  const fatG = macro(raw.fat_g, MACRO_LIMITS.fatG);
  const fromMacros = carbsG !== null && proteinG !== null && fatG !== null ? macro(4 * carbsG + 4 * proteinG + 9 * fatG, MACRO_LIMITS.kcal) : null;
  const tip = typeof raw.tip === 'string' ? clipWords(plainText(raw.tip), TIP_MAX) : '';
  const kcal = macro(raw.kcal, MACRO_LIMITS.kcal);
  // Contradictory numbers: keep them (the athlete edits before saving) but flag them as a rough guess.
  const confidence = macrosMismatch(kcal, fromMacros) ? 'low' : oneOf(CONFIDENCES, raw.confidence) ?? 'low';
  return {
    meal: oneOf(MEAL_SLOTS, raw.meal) ?? mealSlotFromTime(time),
    description,
    items: items(raw.items),
    kcal: kcal ?? fromMacros,
    carbsG,
    proteinG,
    fatG,
    confidence,
    tip: tip || null,
    engine: 'ai',
  };
}
