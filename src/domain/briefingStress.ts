/**
 * The morning briefing's sentence when stress is costing the athlete sleep
 * (`stressSleep.ts`), written to be heard («Llevas tres días con estrés alto y
 * has dormido una hora menos de lo habitual: hoy, suave, y esta noche
 * acuéstate antes.»), and the focus of the day. Pure.
 */
import { clockWords, durationWords, numberToWords } from './briefingSpeech';
import { suggestedBedtime, type StressSleepSignal } from './stressSleep';

/** Spoken minutes rounded to a quarter of an hour («una hora», «tres cuartos de hora»…). */
function roughWords(minutes: number): string {
  const q = Math.max(15, Math.round(minutes / 15) * 15);
  if (q === 45) return 'tres cuartos de hora';
  if (q === 30) return 'media hora';
  if (q === 15) return 'un cuarto de hora';
  return durationWords(q);
}

function worseWords(signal: StressSleepSignal): string {
  const { kind, amount } = signal.worse;
  if (kind === 'hours') return `has dormido ${roughWords(amount)} menos de lo habitual`;
  if (kind === 'score') return `tu sueño puntúa ${numberToWords(amount)} puntos menos de lo habitual`;
  if (kind === 'awake') return `pasas ${roughWords(amount)} más despierto por la noche`;
  return `te acuestas ${roughWords(amount)} más tarde de lo habitual`;
}

/** The spoken sentence, said right after the sleep. */
export function stressSleepSpoken(signal: StressSleepSignal): string {
  const days = numberToWords(signal.stressDays, 'masculine');
  const stress = signal.exam ? `Con los exámenes, llevas ${days} días con estrés alto` : `Llevas ${days} días con estrés alto`;
  const bed = clockWords(suggestedBedtime(signal));
  const advice =
    signal.level === 'high'
      ? `hoy, suave; esta noche, unos minutos de respiración lenta y a la cama sobre ${bed}`
      : `hoy, suave, y esta noche a la cama sobre ${bed}`;
  return `${stress} y ${worseWords(signal)}: ${advice}.`;
}

/** Focus of the day while the signal is on (replaces the usual focus on a training day). */
export const STRESS_SLEEP_FOCUS = 'Hoy suave y sin apurar: lo que más suma ahora es dormir. Acuéstate antes esta noche.';
