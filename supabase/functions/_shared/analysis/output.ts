/**
 * Structured output of the post-workout analysis: strict JSON Schema for the
 * model, then a defensive normalization (plain short sentences, bounded lists)
 * → app `WorkoutAnalysis`.
 */
import { clipWords, plainText } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import { array, object, string, toStructuredOutputSchema } from '../schema.ts';
import type { ISODateTime, UUID, WorkoutAnalysis } from '../types.ts';

export const HEADLINE_MAX = 90;
export const POINT_MAX = 160;
export const NEXT_STEP_MAX = 300;
export const MAX_WENT_WELL = 3;
export const MAX_IMPROVE = 3;

const outputSchema = object({
  headline: string({ min: 1, description: 'Veredicto en una frase (máximo 90 caracteres).' }),
  went_well: array(string(), { description: 'De 1 a 3 cosas que salieron bien, con cifras cuando las haya.' }),
  improve: array(string(), { description: 'De 0 a 3 cosas que ajustar la próxima vez.' }),
  next_step: string({ min: 1, description: 'Qué implica para mañana o la próxima sesión (una o dos frases).' }),
});

export const ANALYSIS_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(outputSchema.json) as Record<string, unknown>;

function points(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is string => typeof p === 'string')
    .map((p) => clipWords(plainText(p), POINT_MAX))
    .filter(Boolean)
    .slice(0, max);
}

/** Model JSON → WorkoutAnalysis. Throws `bad_output` without a headline or a next step. */
export function toWorkoutAnalysis(raw: Record<string, unknown>, workoutId: UUID, createdAt: ISODateTime): WorkoutAnalysis {
  const headline = typeof raw.headline === 'string' ? clipWords(plainText(raw.headline), HEADLINE_MAX) : '';
  const nextStep = typeof raw.next_step === 'string' ? clipWords(plainText(raw.next_step), NEXT_STEP_MAX) : '';
  if (!headline || !nextStep) throw new CoachAiError('bad_output', 'El análisis del entreno no tenía el formato esperado.');
  return {
    workoutId,
    headline,
    wentWell: points(raw.went_well, MAX_WENT_WELL),
    improve: points(raw.improve, MAX_IMPROVE),
    nextStep,
    engine: 'ai',
    createdAt,
  };
}
