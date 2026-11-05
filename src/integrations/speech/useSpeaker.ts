/**
 * Text-to-speech for the morning briefing and coach replies.
 *
 * - Natural voice first: when the repository offers `synthesizeSpeech` (Supabase, AI on) and the
 *   chosen coach voice is one of the Aura-2 voices (`coachVoice.ts`), the text is cut into
 *   sentences and played with expo-audio (`neuralSpeech.ts`). Any failure hands the rest of the
 *   text to the device voice, so the coach never goes silent.
 * - Device voice (expo-speech 58): the best installed Spanish voice, chosen once per app run
 *   (see `voices.ts`). Rate 1.0 = AVSpeechUtteranceDefaultSpeechRate on iOS.
 * - The text is prepared for the ear first (`speechText.ts`: no markdown, "Z2" → "zona 2"…).
 * - Progress: playback time per sentence (natural) or word-boundary events (device).
 * - Only one utterance at a time app-wide: `speak` stops whatever was playing; the hook that
 *   started the current one stops it when it unmounts.
 */
import * as Speech from 'expo-speech';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { RepositoryContext } from '@/data/context';
import { logger } from '@/lib/logger';

import { releaseSpeechPlayback, prepareSpeechPlayback } from './audioSession';
import { coachVoiceName, isNeuralVoice, loadCoachVoice, useCoachVoice } from './coachVoice';
import { playNeural, type NeuralPlayback, type Synthesize } from './neuralSpeech';
import { splitForSpeech, toSpokenText } from './speechText';
import { pickSpanishVoice, speechProgress, voiceDisplayName, voiceTier, type VoiceLike } from './voices';

export interface Speaker {
  speaking: boolean;
  paused: boolean;
  /** 0..1, approximate, for a progress bar. */
  progress: number;
  /** Name of the voice in use ("Carina", "Mónica (mejorada)"), when known. */
  voiceName: string | null;
  /** False when only a compact device voice would be used: show the "descarga una voz mejorada" tip. */
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
/** Natural-voice playback of `currentUtterance`, if that is what is playing. */
let activeNeural: NeuralPlayback | null = null;

function swallow(label: string): (error: unknown) => void {
  return (error) => logger.debug(`speech: ${label} failed`, error);
}

/** Silences whatever is playing (both engines). */
function stopEverything(): void {
  activeNeural?.stop();
  activeNeural = null;
  Speech.stop().catch(swallow('stop'));
}

export function useSpeaker(): Speaker {
  const repository = useContext(RepositoryContext);
  const synthesize: Synthesize | null = repository?.synthesizeSpeech ? (input) => repository.synthesizeSpeech!(input) : null;
  const coachVoice = useCoachVoice();
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [voice, setVoice] = useState<VoiceLike | null>(null);
  /** The utterance THIS instance started (0 = none). */
  const mine = useRef(0);
  const synthesizeRef = useRef(synthesize);
  synthesizeRef.current = synthesize;

  useEffect(() => {
    let alive = true;
    void loadSpanishVoice().then((found) => {
      if (alive) setVoice(found);
    });
    void loadCoachVoice();
    return () => {
      alive = false;
      if (mine.current !== 0 && mine.current === currentUtterance) {
        currentUtterance += 1;
        stopEverything();
        releaseSpeechPlayback();
      }
    };
  }, []);

  const finish = useCallback((id: number, done: boolean) => {
    if (id !== mine.current) return;
    setSpeaking(false);
    setPaused(false);
    setProgress(done ? 1 : 0);
    if (id === currentUtterance) {
      activeNeural = null;
      releaseSpeechPlayback();
    }
  }, []);

  /** Device voice for `text`; `offset` = share of the whole text already spoken by the natural voice. */
  const speakWithDevice = useCallback(
    (id: number, text: string, offset: number) => {
      const content = text.slice(0, Speech.maxSpeechInputLength);
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
            if (id === mine.current) setProgress(offset + (1 - offset) * speechProgress(event.charIndex, event.charLength, content.length));
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

  const speak = useCallback(
    (text: string) => {
      const content = toSpokenText(text);
      currentUtterance += 1;
      const id = currentUtterance;
      mine.current = id;
      stopEverything();
      if (!content) {
        finish(id, false);
        return;
      }
      setSpeaking(true);
      setPaused(false);
      setProgress(0);
      void loadCoachVoice().then((chosenVoice) => {
        if (id !== currentUtterance) {
          finish(id, false);
          return;
        }
        const synth = synthesizeRef.current;
        if (!synth || !isNeuralVoice(chosenVoice)) {
          speakWithDevice(id, content, 0);
          return;
        }
        activeNeural = playNeural(splitForSpeech(content), chosenVoice, synth, {
          onStart: () => undefined,
          onProgress: (value) => {
            if (id === mine.current) setProgress(value);
          },
          onDone: () => finish(id, true),
          onFallback: (rest, offset) => {
            if (id !== currentUtterance) return;
            activeNeural = null;
            speakWithDevice(id, rest, offset);
          },
        });
      });
    },
    [finish, speakWithDevice],
  );

  const stop = useCallback(() => {
    const id = mine.current;
    if (id !== 0 && id === currentUtterance) {
      currentUtterance += 1;
      stopEverything();
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
    if (activeNeural) {
      activeNeural.pause();
      return;
    }
    Speech.pause().catch((error: unknown) => {
      logger.debug('speech: pause unsupported', error);
      setPaused(false);
    });
  }, []);

  const resume = useCallback(() => {
    if (mine.current === 0 || mine.current !== currentUtterance) return;
    setPaused(false);
    if (activeNeural) {
      activeNeural.resume();
      return;
    }
    Speech.resume().catch(swallow('resume'));
  }, []);

  const natural = synthesize !== null && isNeuralVoice(coachVoice);
  return {
    speaking,
    paused,
    progress,
    voiceName: natural ? coachVoiceName(coachVoice) : voice ? voiceDisplayName(voice) : null,
    hasEnhancedVoice: natural || (voice ? voiceTier(voice) >= 2 : false),
    speak,
    pause,
    resume,
    stop,
  };
}
