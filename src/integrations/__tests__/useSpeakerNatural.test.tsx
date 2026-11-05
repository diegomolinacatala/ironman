/**
 * useSpeaker with a repository that offers `synthesizeSpeech`: natural voice first (playNeural),
 * device voice for the rest when it fails, the iPhone voice when the user chose it.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RepositoryContext } from '@/data/context';
import type { Repository } from '@/data/repository';

import { resetCoachVoiceForTests, setCoachVoice } from '../speech/coachVoice';
import type { NeuralCallbacks } from '../speech/neuralSpeech';
import { resetSpeakerVoiceCache, useSpeaker } from '../speech/useSpeaker';

interface NeuralCall {
  chunks: string[];
  voice: string;
  callbacks: NeuralCallbacks;
  playback: { pause: jest.Mock; resume: jest.Mock; stop: jest.Mock };
}

jest.mock('../speech/neuralSpeech', () => {
  const calls: unknown[] = [];
  return {
    calls,
    playNeural: (chunks: string[], voice: string, _synth: unknown, callbacks: unknown) => {
      const playback = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(async () => undefined) };
      calls.push({ chunks, voice, callbacks, playback });
      return playback;
    },
  };
});

jest.mock('expo-speech', () => {
  const spoken: unknown[] = [];
  return {
    spoken,
    maxSpeechInputLength: Number.MAX_VALUE,
    getAvailableVoicesAsync: async () => [
      { identifier: 'com.apple.voice.compact.es-ES.Monica', name: 'Mónica', quality: 'Default', language: 'es-ES' },
    ],
    speak: (text: string, options: unknown) => spoken.push({ text, options }),
    stop: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
  };
});

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn() },
}));

const { calls } = jest.requireMock<{ calls: NeuralCall[] }>('../speech/neuralSpeech');
const speech = jest.requireMock<{ spoken: { text: string; options: { onDone?: () => void } }[]; pause: jest.Mock }>('expo-speech');

const repository = { synthesizeSpeech: jest.fn(async () => null) } as unknown as Repository;
const wrapper = ({ children }: { children: ReactNode }) => <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;

beforeEach(async () => {
  await AsyncStorage.clear();
  calls.length = 0;
  speech.spoken.length = 0;
  jest.clearAllMocks();
  resetSpeakerVoiceCache();
  resetCoachVoiceForTests();
});

describe('useSpeaker with the natural voice', () => {
  test('speaks with the chosen Aura voice, prepared for the ear and cut in sentences', async () => {
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    expect(result.current.voiceName).toBe('Néstor');
    expect(result.current.hasEnhancedVoice).toBe(true);
    await act(async () => {
      result.current.speak('**Hoy** rodaje de 45\' en Z2. Mañana, bici.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].voice).toBe('nestor');
    expect(calls[0].chunks.join(' ')).toBe('Hoy rodaje de 45 minutos en zona 2. Mañana, bici.');
    expect(result.current.speaking).toBe(true);

    await act(async () => {
      calls[0].callbacks.onProgress(0.5);
    });
    expect(result.current.progress).toBe(0.5);
    await act(async () => {
      result.current.pause();
    });
    expect(calls[0].playback.pause).toHaveBeenCalledTimes(1);
    expect(speech.pause).not.toHaveBeenCalled();
    await act(async () => {
      result.current.resume();
    });
    expect(calls[0].playback.resume).toHaveBeenCalledTimes(1);
    await act(async () => {
      calls[0].callbacks.onDone();
    });
    expect(result.current.speaking).toBe(false);
    expect(result.current.progress).toBe(1);
  });

  test('when the natural voice fails, the device voice reads the rest', async () => {
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    await act(async () => {
      result.current.speak('Uno. Dos.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].callbacks.onFallback('Dos.', 0.5);
    });
    await waitFor(() => expect(speech.spoken).toHaveLength(1));
    expect(speech.spoken[0].text).toBe('Dos.');
    expect(result.current.speaking).toBe(true);
    await act(async () => {
      speech.spoken[0].options.onDone?.();
    });
    expect(result.current.speaking).toBe(false);
  });

  test('"Voz del iPhone" skips the natural voice', async () => {
    await setCoachVoice('device');
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    expect(result.current.voiceName).toBe('Mónica');
    await act(async () => {
      result.current.speak('Hola.');
    });
    await waitFor(() => expect(speech.spoken).toHaveLength(1));
    expect(calls).toHaveLength(0);
  });

  test('another screen speaking resets the first one (no stuck "playing" controls)', async () => {
    const first = await renderHook(() => useSpeaker(), { wrapper });
    const second = await renderHook(() => useSpeaker(), { wrapper });
    await act(async () => {
      first.result.current.speak('Informe.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(first.result.current.speaking).toBe(true);
    await act(async () => {
      second.result.current.speak('Muestra.');
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].playback.stop).toHaveBeenCalled();
    expect(first.result.current.speaking).toBe(false);
    expect(second.result.current.speaking).toBe(true);
  });

  test('an interruption shows as paused; resume plays on', async () => {
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    await act(async () => {
      result.current.speak('Hola.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].callbacks.onInterrupted?.();
    });
    expect(result.current.paused).toBe(true);
    await act(async () => {
      result.current.resume();
    });
    expect(calls[0].playback.resume).toHaveBeenCalledTimes(1);
    expect(result.current.paused).toBe(false);
  });

  test('paused when the device voice takes over: it waits for resume', async () => {
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    await act(async () => {
      result.current.speak('Uno. Dos.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].callbacks.onFallback('Dos.', 0.5);
      result.current.pause();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(speech.spoken).toHaveLength(0);
    await act(async () => {
      result.current.resume();
    });
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0].text).toBe('Dos.');
  });

  test('a new text stops the natural playback of the previous one', async () => {
    const { result } = await renderHook(() => useSpeaker(), { wrapper });
    await act(async () => {
      result.current.speak('Primero.');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      result.current.speak('Segundo.');
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].playback.stop).toHaveBeenCalled();
    await act(async () => {
      result.current.stop();
    });
    expect(calls[1].playback.stop).toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
  });
});
