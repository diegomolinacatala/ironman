/**
 * Pure helpers for live dictation (expo-speech-recognition), unit-tested.
 *
 * Result semantics of expo-speech-recognition 58 in continuous mode:
 * - interim results (`isFinal: false`) cover the CURRENT segment only and replace each other;
 * - a final result closes that segment (iOS 18+/Android/web emit one per utterance, iOS 17
 *   emits a single cumulative one when recognition stops; iOS 18 prefixes later segments
 *   with a space). So: append finals, show the latest interim after them.
 */

export interface TranscriptState {
  readonly finals: readonly string[];
  readonly interim: string;
  /** An interim result arrived after the last final (lets us drop a repeated final). */
  readonly sawInterim: boolean;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { finals: [], interim: '', sawInterim: false };

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Next state after a `result` event (`text` = best alternative's transcript). */
export function applyRecognitionResult(state: TranscriptState, isFinal: boolean, text: string): TranscriptState {
  const value = clean(text);
  if (!isFinal) return { ...state, interim: value, sawInterim: true };
  if (!value) return { ...state, interim: '' };
  const last = state.finals[state.finals.length - 1];
  // The same final twice in a row with no speech in between is the engine repeating itself.
  if (last === value && !state.sawInterim) return { ...state, interim: '' };
  return { finals: [...state.finals, value], interim: '', sawInterim: false };
}

/** Everything recognised in this take (finals + current interim), trimmed. */
export function transcriptText(state: TranscriptState): string {
  return clean([...state.finals, state.interim].join(' '));
}

/** `volumechange` values go from -2 to 10 (below 0 is inaudible) → 0..1 for the mic animation. */
export function normaliseVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / 10);
}

/** Biases recognition towards the words athletes say to their coach. */
export const VOICE_CONTEXTUAL_STRINGS: readonly string[] = [
  'rodaje',
  'rodaje suave',
  'series',
  'tirada larga',
  'umbral',
  'zona dos',
  'zona tres',
  'tempo',
  'fartlek',
  'VFC',
  'variabilidad',
  'pulsaciones',
  'Garmin',
  'Strava',
  'brick',
  'transición',
  'FTP',
  'vatios',
  'rodillo',
  'natación',
  'piscina',
  'aguas abiertas',
  'neopreno',
  'triatlón',
  'media distancia',
  'pádel',
  'fuerza',
  'movilidad',
  'gemelo',
  'isquio',
  'fascitis',
  'tendinitis',
  'agujetas',
  'descanso',
  'Road to Ironman',
];

const PERMISSION_MESSAGE =
  'Sin acceso al micrófono o al reconocimiento de voz. Actívalo en Ajustes > Apps > Road to Ironman, o escríbelo con el teclado.';

export const VOICE_MESSAGES = {
  permission: PERMISSION_MESSAGE,
  unavailable: 'El dictado no está disponible en este dispositivo. Escríbelo con el teclado.',
  generic: 'No se pudo reconocer tu voz. Prueba de nuevo o escríbelo.',
} as const;

/**
 * Spanish message for an `error` event, or null when it is not worth showing
 * (we aborted on purpose, or silence after the user already said something).
 */
export function voiceErrorMessage(code: string, hasTranscript: boolean): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'no-speech':
    case 'speech-timeout':
    case 'nomatch':
      return hasTranscript ? null : 'No te he oído. Prueba otra vez, un poco más cerca del micrófono.';
    case 'not-allowed':
    case 'service-not-allowed':
      return PERMISSION_MESSAGE;
    case 'network':
      return 'Sin conexión para reconocer tu voz. Prueba de nuevo o escríbelo.';
    case 'language-not-supported':
      return 'Tu dispositivo no reconoce voz en español. Escríbelo con el teclado.';
    case 'audio-capture':
      return 'No se pudo usar el micrófono. Cierra otras apps que lo usen y prueba de nuevo.';
    case 'interrupted':
      return 'Se ha cortado la escucha (una llamada u otra app). Prueba de nuevo.';
    case 'busy':
      return 'El reconocimiento de voz está ocupado. Prueba de nuevo en un momento.';
    default:
      return VOICE_MESSAGES.generic;
  }
}
