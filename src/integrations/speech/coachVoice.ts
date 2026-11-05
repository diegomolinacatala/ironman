/**
 * Which voice the coach speaks with (stored on the device, like the appearance).
 *
 * The four natural voices are Deepgram Aura-2 Spanish (Spain) voices served free through
 * Workers AI by the `speech` edge function; 'device' is the iPhone's own voice (also the
 * automatic fallback offline, in demo mode or when the daily free allowance is used up).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { SpeechVoice } from '@/domain/types';
import { logger } from '@/lib/logger';

export type NeuralVoice = SpeechVoice;
export const NEURAL_VOICES: readonly NeuralVoice[] = ['carina', 'diana', 'nestor', 'alvaro'];
export type CoachVoice = NeuralVoice | 'device';

export const DEFAULT_COACH_VOICE: CoachVoice = 'nestor';
export const COACH_VOICE_STORAGE_KEY = 'rti.coachVoice';

export interface CoachVoiceOption {
  value: CoachVoice;
  name: string;
  description: string;
}

export const COACH_VOICE_OPTIONS: readonly CoachVoiceOption[] = [
  { value: 'nestor', name: 'Néstor', description: 'Hombre · tranquilo y cercano' },
  { value: 'carina', name: 'Carina', description: 'Mujer · cálida y con energía' },
  { value: 'diana', name: 'Diana', description: 'Mujer · clara y expresiva' },
  { value: 'alvaro', name: 'Álvaro', description: 'Hombre · sereno y claro' },
  { value: 'device', name: 'Voz del iPhone', description: 'Sin conexión, la que tengas instalada' },
];

export function isNeuralVoice(value: unknown): value is NeuralVoice {
  return typeof value === 'string' && (NEURAL_VOICES as readonly string[]).includes(value);
}

function isCoachVoice(value: unknown): value is CoachVoice {
  return value === 'device' || isNeuralVoice(value);
}

export function coachVoiceName(voice: CoachVoice): string {
  return COACH_VOICE_OPTIONS.find((option) => option.value === voice)?.name ?? voice;
}

let current: CoachVoice = DEFAULT_COACH_VOICE;
let loaded: Promise<CoachVoice> | null = null;
let chosenThisSession = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCoachVoice(): CoachVoice {
  return current;
}

/** Reads the stored choice once (later calls reuse it). Never throws. */
export function loadCoachVoice(): Promise<CoachVoice> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(COACH_VOICE_STORAGE_KEY)
      .then((stored) => {
        if (!chosenThisSession && isCoachVoice(stored) && stored !== current) {
          current = stored;
          emit();
        }
        return current;
      })
      .catch((error: unknown) => {
        logger.debug('speech: could not read the coach voice', error);
        return current;
      });
  }
  // Re-read `current`: the user may have picked a voice after the first load.
  return loaded.then(() => current);
}

export async function setCoachVoice(voice: CoachVoice): Promise<void> {
  current = voice;
  chosenThisSession = true;
  emit();
  try {
    await AsyncStorage.setItem(COACH_VOICE_STORAGE_KEY, voice);
  } catch (error) {
    logger.debug('speech: could not save the coach voice', error);
  }
}

export function useCoachVoice(): CoachVoice {
  return useSyncExternalStore(subscribe, getCoachVoice, getCoachVoice);
}

/** Test helper. */
export function resetCoachVoiceForTests(): void {
  current = DEFAULT_COACH_VOICE;
  loaded = null;
  chosenThisSession = false;
  emit();
}
