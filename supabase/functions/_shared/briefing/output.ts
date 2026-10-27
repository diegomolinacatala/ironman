/**
 * Structured output of the briefing `{ headline, sleep_verdict, sleep_summary,
 * script, focus }`: JSON Schema for Claude plus validation/normalization of the
 * answer (plain text for speech and the lock screen, length caps, verdict enum).
 */
import { clipWords, plainText, wordCount } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import { enumOf, object, string, toStructuredOutputSchema } from '../schema.ts';
import { SLEEP_VERDICTS } from '../types.ts';
import type { SleepVerdict } from '../types.ts';

export const HEADLINE_MAX = 90;
export const SUMMARY_MAX = 300;
export const FOCUS_MAX = 200;
export const SCRIPT_MAX_CHARS = 4000;
/** Accepted script length (the prompt asks for 110–200 words). */
export const SCRIPT_MIN_WORDS = 40;
export const SCRIPT_MAX_WORDS = 450;

const outputSchema = object(
  {
    headline: string({ min: 1, description: 'Titular de máximo 90 caracteres.' }),
    sleep_verdict: enumOf(SLEEP_VERDICTS),
    sleep_summary: string({ description: 'Una frase sobre la noche.' }),
    script: string({ min: 1, description: 'Guion para leer en voz alta, 110-200 palabras.' }),
    focus: string({ description: 'Un consejo accionable para hoy.' }),
  },
  undefined,
  // Extra keys from weaker models are ignored; the five fields stay strictly validated.
  { stripUnknown: true },
);

export const BRIEFING_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(outputSchema.json) as Record<string, unknown>;

export interface BriefingText {
  headline: string;
  sleepVerdict: SleepVerdict;
  sleepSummary: string;
  script: string;
  focus: string;
}

const badOutput = (why: string): CoachAiError => new CoachAiError('bad_output', `El informe no tenía el formato esperado (${why}).`);

/**
 * Validates and normalizes the model's JSON. Without sleep data the verdict is
 * forced to 'unknown'. Throws a `bad_output` CoachAiError when unusable.
 */
export function parseBriefingOutput(value: Record<string, unknown>, hasSleepData: boolean): BriefingText {
  const parsed = outputSchema.parse(value, '');
  if (!parsed.ok) throw badOutput(parsed.error);
  const o = parsed.value;
  const headline = clipWords(plainText(o.headline), HEADLINE_MAX);
  const script = plainText(o.script);
  const words = wordCount(script);
  if (!headline) throw badOutput('titular vacío');
  if (words < SCRIPT_MIN_WORDS || words > SCRIPT_MAX_WORDS) throw badOutput(`guion de ${words} palabras`);
  return {
    headline,
    sleepVerdict: hasSleepData ? o.sleep_verdict : 'unknown',
    sleepSummary: clipWords(plainText(o.sleep_summary), SUMMARY_MAX),
    script: clipWords(script, SCRIPT_MAX_CHARS),
    focus: clipWords(plainText(o.focus), FOCUS_MAX),
  };
}
