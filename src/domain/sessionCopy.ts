/**
 * Copy helpers of the session library: the coaching within the contract
 * limits and the small Spanish phrases the recipes share ("Las tres series",
 * "3×8'", a single block instead of "1×15'"…). Re-exported by `sessionKit.ts`
 * for the recipes. Pure.
 */
import { numberToWords } from './briefingSpeech';
import type { IntervalPlan } from './sessionKit';
import type { WorkoutCoaching } from './types';
import { formatStepMinutes } from './zones';

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** WorkoutCoaching within the contract limits (objective/success/plan B ≤ 200, ≤ 4 keys of ≤ 160). */
export function coachingOf(objective: string, keys: readonly string[], success: string, planB: string | null): WorkoutCoaching {
  return {
    objective: clip(objective, 200),
    keys: keys
      .map((k) => clip(k, 160))
      .filter((k) => k.length > 0)
      .slice(0, 4),
    success: clip(success, 200),
    planB: planB === null ? null : clip(planB, 200),
  };
}

/** Copy by count of sets: `byCount(reps, 'Bloque', 'Series')`. */
export function byCount(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/** "3×8'" or, when the session only fits one block, "15'" (titles). */
export function setsText(p: IntervalPlan): string {
  return p.reps > 1 ? `${p.reps}×${formatStepMinutes(p.work)}` : formatStepMinutes(p.work);
}

/** "3×8' en umbral (Z4) con 2' de trote entre series." or, with one block, "Un bloque de 15' en …". */
export function intervalSummary(p: IntervalPlan, zone: string, restWords: string): string {
  if (p.reps <= 1) return `Un bloque de ${formatStepMinutes(p.work)} en ${zone}, con calentamiento y vuelta a la calma suaves.`;
  return `${p.reps}×${formatStepMinutes(p.work)} en ${zone} con ${formatStepMinutes(p.rest)} ${restWords} entre series.`;
}

/** ", la última igual que la primera" with two or more sets, else ", sin perder <what> al final". */
export function evenSets(reps: number, what: string): string {
  return reps > 1 ? ', la última igual que la primera' : `, sin perder ${what} al final`;
}

/** First key of threshold work: start at the easy end of the range. */
export function startLowKey(reps: number, end: 'baja' | 'lenta'): string {
  const tail = reps > 1 ? ': la última serie es la que cuenta.' : ' y ve de menos a más.';
  return `Empieza en la parte ${end} del rango${tail}`;
}

/** First key of VO2 work. */
export function repeatableKey(reps: number): string {
  return reps > 1 ? 'Muy duro pero repetible: todas las series deben salir parecidas.' : 'Muy duro pero controlado: no salgas a tope en el primer minuto.';
}

/** "Las tres series" / "El bloque" when the session only fits one (start of a sentence). */
export function theSets(n: number): string {
  return n <= 1 ? 'El bloque' : `Las ${numberToWords(n, 'feminine')} series`;
}

/** "Los dos bloques" / "El bloque" (start of a sentence). */
export function theBlocks(n: number): string {
  return n <= 1 ? 'El bloque' : `Los ${numberToWords(n, 'masculine')} bloques`;
}

/** "Las ocho subidas" / "La subida" (start of a sentence). */
export function theClimbs(n: number): string {
  return n <= 1 ? 'La subida' : `Las ${numberToWords(n, 'feminine')} subidas`;
}

/** Lower-cases the first letter ("Las tres series" → "las tres series"). */
export function lowerStart(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}
