/**
 * Live speech-to-text (expo-speech-recognition 58): es-ES, continuous, interim results,
 * on-device when the iPhone has the Spanish model (no 1-minute server limit, audio stays on
 * the phone). Web uses the browser's SpeechRecognition when there is one.
 *
 * Recognition events are global, so each hook instance only reacts while a take IT started
 * is live. A take stops by itself after 90 s.
 */
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';

import {
  applyRecognitionResult,
  EMPTY_TRANSCRIPT,
  normaliseVolume,
  transcriptText,
  VOICE_CONTEXTUAL_STRINGS,
  VOICE_MESSAGES,
  voiceErrorMessage,
  type TranscriptState,
} from './transcript';

export type VoiceState = 'idle' | 'requesting' | 'listening' | 'stopping' | 'error' | 'unavailable';

export interface VoiceInput {
  state: VoiceState;
  /** Everything recognised so far in this take (final + interim), trimmed. */
  transcript: string;
  /** Normalised mic level 0..1 for the listening animation. */
  level: number;
  /** Spanish, user-facing ("Sin acceso al micrófono…"), or null. */
  error: string | null;
  /** False on web/devices without speech recognition: offer the keyboard instead. */
  available: boolean;
  /** Asks permission when needed, then starts listening. */
  start(): Promise<void>;
  /** Stops and keeps the final transcript. */
  stop(): void;
  /** Stops and discards. */
  cancel(): void;
  /** Clears transcript and error, back to idle. */
  reset(): void;
}

export const MAX_TAKE_MS = 90_000;
const VOLUME_INTERVAL_MS = 100;

function isRecognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch (error) {
    logger.debug('voice: recognition unavailable', error);
    return false;
  }
}

function startRecognition(): void {
  ExpoSpeechRecognitionModule.start({
    lang: 'es-ES',
    interimResults: true,
    continuous: true,
    addsPunctuation: true,
    requiresOnDeviceRecognition: true,
    maxAlternatives: 1,
    iosTaskHint: 'dictation',
    contextualStrings: [...VOICE_CONTEXTUAL_STRINGS],
    volumeChangeEventOptions: { enabled: true, intervalMillis: VOLUME_INTERVAL_MS },
  });
}

async function hasPermission(): Promise<boolean> {
  const response = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return response.granted;
}

interface TakeRefs {
  /** A take started by THIS hook is live (events from other instances are ignored). */
  active: { current: boolean };
  /** cancel(): ignore whatever arrives until the engine ends. */
  discarding: { current: boolean };
  take: { current: TranscriptState };
}

interface TakeSetters {
  updateTake(next: TranscriptState): void;
  setState(update: VoiceState | ((current: VoiceState) => VoiceState)): void;
  setLevel(level: number): void;
  setError(message: string | null): void;
  clearTimer(): void;
}

function useRecognitionListeners(refs: TakeRefs, set: TakeSetters): void {
  const live = () => refs.active.current && !refs.discarding.current;
  const fail = (code: string, detail?: string) => {
    const message = voiceErrorMessage(code, transcriptText(refs.take.current).length > 0);
    if (!message) return;
    logger.warn(`voice: ${code}`, detail);
    set.setError(message);
    set.setState('error');
  };

  useSpeechRecognitionEvent('start', () => {
    if (live()) set.setState('listening');
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (live()) set.updateTake(applyRecognitionResult(refs.take.current, event.isFinal, event.results[0]?.transcript ?? ''));
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (live()) set.setLevel(normaliseVolume(event.value));
  });
  useSpeechRecognitionEvent('nomatch', () => {
    if (live()) fail('nomatch');
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (live()) fail(event.error, event.message);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!refs.active.current) return;
    refs.active.current = false;
    refs.discarding.current = false;
    set.clearTimer();
    set.setLevel(0);
    set.setState((current) => (current === 'error' ? 'error' : 'idle'));
  });
}

export function useVoiceInput(): VoiceInput {
  const [available] = useState(isRecognitionAvailable);
  const [state, setState] = useState<VoiceState>(available ? 'idle' : 'unavailable');
  const [take, setTake] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const discarding = useRef(false);
  const takeRef = useRef<TranscriptState>(EMPTY_TRANSCRIPT);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /** start() is awaiting permission. */
  const starting = useRef(false);
  /** Bumped by start / cancel / reset: a start that was superseded while awaiting does nothing. */
  const startAttempt = useRef(0);

  const updateTake = useCallback((next: TranscriptState) => {
    takeRef.current = next;
    setTake(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useRecognitionListeners(
    { active, discarding, take: takeRef },
    { updateTake, setState, setLevel, setError, clearTimer },
  );

  const stop = useCallback(() => {
    if (!active.current) return;
    clearTimer();
    setState('stopping');
    setLevel(0);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (err) {
      logger.warn('voice: stop failed', err);
      active.current = false;
      setState('idle');
    }
  }, [clearTimer]);

  const cancel = useCallback(() => {
    startAttempt.current += 1;
    clearTimer();
    updateTake(EMPTY_TRANSCRIPT);
    setLevel(0);
    if (!active.current) {
      // Cancelled while the permission prompt was up: that start() will not begin.
      if (starting.current) setState(available ? 'idle' : 'unavailable');
      return;
    }
    discarding.current = true;
    setState('stopping');
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch (err) {
      logger.warn('voice: abort failed', err);
      active.current = false;
      discarding.current = false;
      setState('idle');
    }
  }, [available, clearTimer, updateTake]);

  const start = useCallback(async () => {
    if (!available) {
      setError(VOICE_MESSAGES.unavailable);
      return;
    }
    // Set before the first await: a double tap while starting, listening or stopping is ignored.
    if (starting.current || active.current) return;
    starting.current = true;
    const attempt = ++startAttempt.current;
    setError(null);
    setState('requesting');
    try {
      const granted = await hasPermission();
      // Unmounted, cancelled or reset while the permission prompt was up.
      if (!mounted.current || attempt !== startAttempt.current) return;
      if (!granted) {
        setError(VOICE_MESSAGES.permission);
        setState('error');
        return;
      }
      updateTake(EMPTY_TRANSCRIPT);
      setLevel(0);
      discarding.current = false;
      active.current = true;
      clearTimer();
      startRecognition();
      timer.current = setTimeout(stop, MAX_TAKE_MS);
    } catch (err) {
      logger.warn('voice: could not start', err);
      active.current = false;
      clearTimer();
      if (!mounted.current) return;
      setError(VOICE_MESSAGES.generic);
      setState('error');
    } finally {
      starting.current = false;
    }
  }, [available, stop, updateTake, clearTimer]);

  const reset = useCallback(() => {
    startAttempt.current += 1;
    if (active.current) cancel();
    updateTake(EMPTY_TRANSCRIPT);
    setError(null);
    setLevel(0);
    setState(available ? 'idle' : 'unavailable');
  }, [available, cancel, updateTake]);

  // Leaving the screen never leaves the microphone on.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (!active.current) return;
      active.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch (err) {
        logger.debug('voice: abort on unmount failed', err);
      }
    };
  }, []);

  return {
    state,
    transcript: transcriptText(take),
    level,
    error,
    available,
    start,
    stop,
    cancel,
    reset,
  };
}
