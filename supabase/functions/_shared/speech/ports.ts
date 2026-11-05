/**
 * Ports of the natural text-to-speech function (`speech`): the budget store (consent + the atomic
 * `svc_reserve_speech` reservation) and the synthesizer (our Cloudflare worker, POST /v1/speech).
 * Pure types: adapters live in `platform/speech-store.ts` and `platform/workers-speech.ts`.
 */
import type { ISODateTime, UUID } from '../types.ts';

export const SPEECH_FUNCTION = 'speech';

/** Voices the worker knows (Aura-2 Spanish voices; MeloTTS ignores the voice). */
export const SPEECH_VOICES = ['carina', 'diana', 'nestor', 'alvaro'] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
export const DEFAULT_SPEECH_VOICE: SpeechVoice = 'nestor';

/** premium = Deepgram Aura-2 (natural, costs more neurons) · basic = MeloTTS (cheap). */
export type SpeechTier = 'premium' | 'basic';

/** The only audio types passed on to the app. */
export const SPEECH_MIMES = ['audio/mpeg', 'audio/wav'] as const;
export type SpeechMime = (typeof SPEECH_MIMES)[number];

export interface SpeechLimits {
  /** Characters (any tier) allowed per user in the last 24 h (rolling). */
  userDailyChars: number;
  /** Characters one user may send to the premium voice per UTC day (their share of the premium budget). */
  userPremiumDailyChars: number;
  /** Characters sent to the premium voice per UTC day, across all users. */
  premiumDailyChars: number;
  /** Characters sent to the basic voice per UTC day, across all users. */
  basicDailyChars: number;
}

export interface SpeechBudgetStore {
  getAiConsentAt(userId: UUID): Promise<ISODateTime | null>;
  /**
   * Atomically checks the user's 24 h character limit, their premium share and the global premium /
   * basic budgets of the UTC day, and records the call (before the worker call: failed calls stay
   * counted). Returns the tier, or null when the user or both daily budgets are spent.
   */
  reserveSpeech(userId: UUID, chars: number, limits: SpeechLimits): Promise<SpeechTier | null>;
}

export interface SpeechSynthesisRequest {
  userId: UUID;
  text: string;
  voice: SpeechVoice;
  tier: SpeechTier;
  signal: AbortSignal;
}

export interface SpeechAudio {
  bytes: Uint8Array;
  mime: SpeechMime;
  /** Model the worker used (`x-speech-model`). */
  model: string;
}

export interface SpeechPort {
  /** Throws SpeechUnavailableError on any failure (the app then uses the on-device voice). */
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechAudio>;
}

export type SpeechFailureCode = 'quota' | 'rate_limited' | 'misconfigured' | 'rejected' | 'upstream' | 'network' | 'timeout' | 'bad_audio';

export class SpeechUnavailableError extends Error {
  readonly code: SpeechFailureCode;
  constructor(code: SpeechFailureCode, message: string) {
    super(message);
    this.name = 'SpeechUnavailableError';
    this.code = code;
  }
}
