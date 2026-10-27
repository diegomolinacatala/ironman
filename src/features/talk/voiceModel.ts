/**
 * Pure helpers around `useVoiceInput`: when a take is over, what the mic
 * button says to VoiceOver, and whether an error needs the Settings app.
 */
import type { VoiceState } from '@/integrations/speech/useVoiceInput';

const LIVE: readonly VoiceState[] = ['requesting', 'listening', 'stopping'];

export function isLive(state: VoiceState): boolean {
  return LIVE.includes(state);
}

/**
 * True when a take just ended (the user tapped to finish or the recogniser stopped on silence).
 * A take the app discarded on purpose (switch to the keyboard, new conversation) is not a result.
 */
export function takeFinished(previous: VoiceState, next: VoiceState, discarded: boolean = false): boolean {
  return !discarded && (previous === 'listening' || previous === 'stopping') && next === 'idle';
}

export interface MicCopy {
  label: string;
  hint: string;
  caption: string;
}

export function micCopy(state: VoiceState): MicCopy {
  switch (state) {
    case 'requesting':
      return { label: 'Preparando el micrófono', hint: 'Espera un momento', caption: 'Preparando…' };
    case 'listening':
      return { label: 'Terminar de hablar', hint: 'Envía lo que has dicho a tu coach', caption: 'Te escucho · toca para terminar' };
    case 'stopping':
      return { label: 'Terminando', hint: 'Enviando lo que has dicho', caption: 'Un segundo…' };
    default:
      return { label: 'Hablar con tu coach', hint: 'Empieza a escuchar. Vuelve a tocar para terminar', caption: 'Toca y cuéntaselo' };
  }
}

/** Permission errors can only be fixed in Ajustes: offer the shortcut. */
export function needsSettings(message: string | null | undefined): boolean {
  return Boolean(message && /ajustes|permiso|acceso/i.test(message));
}

/** Joins dictated text to what was already typed. */
export function appendDictation(current: string, dictated: string): string {
  const head = current.trim();
  const tail = dictated.trim();
  if (!tail) return current;
  return head ? `${head} ${tail}` : tail;
}
