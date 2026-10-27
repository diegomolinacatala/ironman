/**
 * Text-to-speech for the morning briefing and coach replies (expo-speech 58).
 *
 * - Voice: the best installed Spanish voice, chosen once per app run (see `voices.ts`).
 * - Rate 1.0 = AVSpeechUtteranceDefaultSpeechRate on iOS, the natural pace for these voices.
 * - Progress comes from word-boundary events (charIndex / text length).
 * - pause/resume exist on iOS and web (not Android).
 * - Only one utterance at a time app-wide: `speak` stops whatever was playing; the hook that
 *   started the current one stops it when it unmounts.
 */
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';

import { prepareSpeechPlayback, releaseSpeechPlayback } from './audioSession';
import { pickSpanishVoice, speechProgress, voiceDisplayName, voiceTier, type VoiceLike } from './voices';

export interface Speaker {
  speaking: boolean;
  paused: boolean;
  /** 0..1, approximate (word-boundary events), for a progress bar. */
  progress: number;
  /** Name of the voice in use ("Mónica (mejorada)"), when known. */
  voiceName: string | null;
  /** False when only the compact voice is installed: show the "descarga una voz mejorada" tip. */
  hasEnhancedVoice: boolean;
  /** Stops anything playing and reads `text`. */
  speak(text: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export const SPEECH_RATE = 1.0;
const FALLBACK_LANGUAGE = 'es-ES';

let voicePromise: Promise<VoiceLike | null> | null = null;

/** Best Spanish voice, looked up once (an empty list is retried next time: web loads voices lazily). */
export function loadSpanishVoice(): Promise<VoiceLike | null> {
  if (!voicePromise) {
    voicePromise = Speech.getAvailableVoicesAsync()
      .then((voices) => {
        const voice = pickSpanishVoice(voices);
        if (!voice) voicePromise = null;
        return voice;
      })
      .catch((error: unknown) => {
        logger.warn('speech: could not list voices', error);
        voicePromise = null;
        return null;
      });
  }
  return voicePromise;
}

/** Test hook: forget the cached voice. */
export function resetSpeakerVoiceCache(): void {
  voicePromise = null;
}

/** Id of the utterance currently owned by a hook instance (app-wide). */
let currentUtterance = 0;

function swallow(label: string): (error: unknown) => void {
  return (error) => logger.debug(`speech: ${label} failed`, error);
}

export function useSpeaker(): Speaker {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voice, setVoice] = useState<VoiceLike | null>(null);
  /** The utterance THIS instance started (0 = none). */
  const mine = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadSpanishVoice().then((found) => {
      if (alive) setVoice(found);
    });
    return () => {
      alive = false;
      if (mine.current !== 0 && mine.current === currentUtterance) {
        currentUtterance += 1;
        Speech.stop().catch(swallow('stop'));
        releaseSpeechPlayback();
      }
    };
  }, []);

  const finish = useCallback((id: number, done: boolean) => {
    if (id !== mine.current) return;
    setSpeaking(false);
    setPaused(false);
    setProgress(done ? 1 : 0);
    if (id === currentUtterance) releaseSpeechPlayback();
  }, []);

  const speak = useCallback(
    (text: string) => {
      const content = text.trim().slice(0, Speech.maxSpeechInputLength);
      currentUtterance += 1;
      const id = currentUtterance;
      mine.current = id;
      Speech.stop().catch(swallow('stop'));
      if (!content) {
        finish(id, false);
        return;
      }
      setSpeaking(true);
      setPaused(false);
      setProgress(0);
      void loadSpanishVoice().then((chosen) => {
        // Superseded while the voice loaded (another speak / stop): never start it.
        if (id !== currentUtterance) {
          finish(id, false);
          return;
        }
        prepareSpeechPlayback();
        Speech.speak(content, {
          language: chosen?.language ?? FALLBACK_LANGUAGE,
          voice: chosen?.identifier,
          rate: SPEECH_RATE,
          pitch: 1,
          onBoundary: (event: { charIndex: number; charLength: number }) => {
            if (id === mine.current) setProgress(speechProgress(event.charIndex, event.charLength, content.length));
          },
          onDone: () => finish(id, true),
          onStopped: () => finish(id, false),
          onError: (error: Error) => {
            logger.warn('speech: could not speak', error);
            finish(id, false);
          },
        });
      });
    },
    [finish],
  );

  const stop = useCallback(() => {
    const id = mine.current;
    if (id !== 0 && id === currentUtterance) {
      currentUtterance += 1;
      Speech.stop().catch(swallow('stop'));
      releaseSpeechPlayback();
    }
    mine.current = 0;
    setSpeaking(false);
    setPaused(false);
    setProgress(0);
  }, []);

  const pause = useCallback(() => {
    if (mine.current === 0 || mine.current !== currentUtterance) return;
    setPaused(true);
    Speech.pause().catch((error: unknown) => {
      logger.debug('speech: pause unsupported', error);
      setPaused(false);
    });
  }, []);

  const resume = useCallback(() => {
    if (mine.current === 0 || mine.current !== currentUtterance) return;
    setPaused(false);
    Speech.resume().catch(swallow('resume'));
  }, []);

  return {
    speaking,
    paused,
    progress,
    voiceName: voice ? voiceDisplayName(voice) : null,
    hasEnhancedVoice: voice ? voiceTier(voice) >= 2 : false,
    speak,
    pause,
    resume,
    stop,
  };
}
