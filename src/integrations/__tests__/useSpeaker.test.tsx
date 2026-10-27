/**
 * useSpeaker against a fake expo-speech: best Spanish voice, progress from word boundaries,
 * pause / resume, one utterance at a time and stop on unmount.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { resetSpeakerVoiceCache, SPEECH_RATE, useSpeaker } from '../speech/useSpeaker';

interface SpokenCall {
  text: string;
  options: {
    language?: string;
    voice?: string;
    rate?: number;
    onBoundary?: (event: { charIndex: number; charLength: number }) => void;
    onDone?: () => void;
    onStopped?: () => void;
  };
}

interface FakeSpeech {
  calls: SpokenCall[];
  stop: jest.Mock<() => Promise<void>>;
  pause: jest.Mock<() => Promise<void>>;
  resume: jest.Mock<() => Promise<void>>;
}

jest.mock('expo-speech', () => {
  const fake = {
    calls: [] as unknown[],
    stop: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
  };
  return {
    fake,
    maxSpeechInputLength: Number.MAX_VALUE,
    getAvailableVoicesAsync: async () => [
      { identifier: 'com.apple.voice.compact.es-ES.Monica', name: 'Mónica', quality: 'Default', language: 'es-ES' },
      { identifier: 'com.apple.voice.enhanced.es-ES.Monica', name: 'Mónica', quality: 'Enhanced', language: 'es-ES' },
      { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', quality: 'Default', language: 'en-US' },
    ],
    speak: (text: string, options: unknown) => fake.calls.push({ text, options }),
    stop: fake.stop,
    pause: fake.pause,
    resume: fake.resume,
  };
});

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn() },
}));

const { fake } = jest.requireMock<{ fake: FakeSpeech }>('expo-speech');

beforeEach(() => {
  fake.calls.length = 0;
  jest.clearAllMocks();
  resetSpeakerVoiceCache();
});

async function speakAndWait(hook: { current: ReturnType<typeof useSpeaker> }, text: string): Promise<SpokenCall> {
  const before = fake.calls.length;
  await act(async () => {
    hook.current.speak(text);
  });
  await waitFor(() => expect(fake.calls.length).toBe(before + 1));
  return fake.calls[before] as SpokenCall;
}

describe('useSpeaker', () => {
  test('reads with the best Spanish voice and reports progress until done', async () => {
    const { result: hook } = await renderHook(() => useSpeaker());
    await waitFor(() => expect(hook.current.voiceName).toBe('Mónica (mejorada)'));
    expect(hook.current.hasEnhancedVoice).toBe(true);

    const text = 'Has dormido siete horas.';
    const call = await speakAndWait(hook, text);
    expect(call.text).toBe(text);
    expect(call.options).toEqual(
      expect.objectContaining({ language: 'es-ES', voice: 'com.apple.voice.enhanced.es-ES.Monica', rate: SPEECH_RATE }),
    );
    expect(hook.current.speaking).toBe(true);

    await act(async () => {
      call.options.onBoundary?.({ charIndex: 4, charLength: 7 });
    });
    expect(hook.current.progress).toBeCloseTo(11 / text.length);

    await act(async () => {
      call.options.onDone?.();
    });
    expect(hook.current.speaking).toBe(false);
    expect(hook.current.progress).toBe(1);
  });

  test('pause and resume', async () => {
    const { result: hook } = await renderHook(() => useSpeaker());
    await speakAndWait(hook, 'Hola');
    await act(async () => {
      hook.current.pause();
    });
    expect(fake.pause).toHaveBeenCalledTimes(1);
    expect(hook.current.paused).toBe(true);
    await act(async () => {
      hook.current.resume();
    });
    expect(fake.resume).toHaveBeenCalledTimes(1);
    expect(hook.current.paused).toBe(false);
  });

  test('a new text replaces the old one; the old "stopped" event is ignored', async () => {
    const { result: hook } = await renderHook(() => useSpeaker());
    const first = await speakAndWait(hook, 'Primero');
    const second = await speakAndWait(hook, 'Segundo');
    expect(fake.stop).toHaveBeenCalled();
    await act(async () => {
      first.options.onStopped?.();
    });
    expect(hook.current.speaking).toBe(true);
    await act(async () => {
      second.options.onStopped?.();
    });
    expect(hook.current.speaking).toBe(false);
  });

  test('stop() and unmount silence it', async () => {
    const { result: hook, unmount } = await renderHook(() => useSpeaker());
    await speakAndWait(hook, 'Hola');
    await act(async () => {
      hook.current.stop();
    });
    expect(hook.current.speaking).toBe(false);
    const stopsAfterStop = fake.stop.mock.calls.length;

    await speakAndWait(hook, 'Otra vez');
    await unmount();
    expect(fake.stop.mock.calls.length).toBeGreaterThan(stopsAfterStop + 1);
  });
});
