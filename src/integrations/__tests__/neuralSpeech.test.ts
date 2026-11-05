/** playNeural with fake players: order, prefetch, progress, pause while loading, fallback, stop. */
import { describe, expect, jest, test } from '@jest/globals';
import type { AudioStatus } from 'expo-audio';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn() },
}));

import { chunkProgress, playNeural, type NeuralCallbacks, type NeuralDeps, type PlayerLike } from '../speech/neuralSpeech';

interface FakePlayer extends PlayerLike {
  uri: string;
  emit: (status: Partial<AudioStatus>) => void;
  playing: boolean;
  removed: boolean;
}

function setup(audio: Record<string, string | null | Promise<string | null>>) {
  const players: FakePlayer[] = [];
  const requested: string[] = [];
  const deps: NeuralDeps = {
    prepareAudio: async () => undefined,
    audioUri: async (text) => {
      requested.push(text);
      return audio[text] ?? null;
    },
    createPlayer: (uri) => {
      let listener: ((status: AudioStatus) => void) | null = null;
      const player: FakePlayer = {
        uri,
        playing: false,
        removed: false,
        play: () => {
          player.playing = true;
        },
        pause: () => {
          player.playing = false;
        },
        remove: () => {
          player.removed = true;
        },
        addListener: (_event, fn) => {
          listener = fn;
          return { remove: () => (listener = null) };
        },
        emit: (status) => listener?.({ currentTime: 0, duration: 0, didJustFinish: false, error: null, ...status } as AudioStatus),
      };
      players.push(player);
      return player;
    },
  };
  const callbacks = {
    onStart: jest.fn(),
    onProgress: jest.fn(),
    onDone: jest.fn(),
    onFallback: jest.fn(),
  } satisfies NeuralCallbacks;
  return { deps, callbacks, players, requested };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('playNeural', () => {
  test('plays the pieces in order, prefetching ahead, and reports progress', async () => {
    const { deps, callbacks, players, requested } = setup({ 'Uno.': 'f1', 'Dos dos.': 'f2', 'Tres.': 'f3', 'Cuatro.': 'f4' });
    playNeural(['Uno.', 'Dos dos.', 'Tres.', 'Cuatro.'], 'carina', jest.fn(async () => null), callbacks, deps);
    await flush();
    expect(players.map((p) => p.uri)).toEqual(['f1']);
    expect(players[0].playing).toBe(true);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(requested.slice(0, 3)).toEqual(['Uno.', 'Dos dos.', 'Tres.']);

    players[0].emit({ currentTime: 1, duration: 2 });
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(chunkProgress([4, 8, 5, 7], 0, 0.5));

    players[0].emit({ didJustFinish: true, currentTime: 2, duration: 2 });
    await flush();
    expect(players[0].removed).toBe(true);
    expect(players[1].uri).toBe('f2');
    expect(requested).toContain('Cuatro.');

    for (const i of [1, 2, 3]) {
      players[i].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
      await flush();
    }
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(1);
    expect(callbacks.onFallback).not.toHaveBeenCalled();
  });

  test('a piece that cannot be synthesised hands the rest to the device voice', async () => {
    const { deps, callbacks, players } = setup({ 'Uno.': 'f1', 'Dos.': null, 'Tres.': 'f3' });
    playNeural(['Uno.', 'Dos.', 'Tres.'], 'nestor', jest.fn(async () => null), callbacks, deps);
    await flush();
    players[0].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
    await flush();
    expect(callbacks.onFallback).toHaveBeenCalledWith('Dos. Tres.', chunkProgress([4, 4, 5], 1, 0));
    expect(players).toHaveLength(1);
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  test('nothing available at all → the whole text goes to the device voice', async () => {
    const { deps, callbacks, players } = setup({});
    playNeural(['Hola.', 'Adiós.'], 'diana', jest.fn(async () => null), callbacks, deps);
    await flush();
    expect(callbacks.onFallback).toHaveBeenCalledWith('Hola. Adiós.', 0);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(players).toHaveLength(0);
  });

  test('a playback error also falls back', async () => {
    const { deps, callbacks, players } = setup({ 'Uno.': 'f1', 'Dos.': 'f2' });
    playNeural(['Uno.', 'Dos.'], 'carina', jest.fn(async () => null), callbacks, deps);
    await flush();
    players[0].emit({ error: 'decoder' } as Partial<AudioStatus>);
    expect(callbacks.onFallback).toHaveBeenCalledWith('Uno. Dos.', 0);
    expect(players[0].removed).toBe(true);
  });

  test('pause while the first piece loads: it waits for resume', async () => {
    let release: (uri: string) => void = () => undefined;
    const first = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const { deps, callbacks, players } = setup({ 'Uno.': first });
    const playback = playNeural(['Uno.'], 'carina', jest.fn(async () => null), callbacks, deps);
    playback.pause();
    release('f1');
    await flush();
    expect(players).toHaveLength(0);
    playback.resume();
    expect(players).toHaveLength(1);
    expect(players[0].playing).toBe(true);
  });

  test('pause / resume / stop drive the player; stop ignores later events', async () => {
    const { deps, callbacks, players } = setup({ 'Uno.': 'f1', 'Dos.': 'f2' });
    const playback = playNeural(['Uno.', 'Dos.'], 'carina', jest.fn(async () => null), callbacks, deps);
    await flush();
    playback.pause();
    expect(players[0].playing).toBe(false);
    playback.resume();
    expect(players[0].playing).toBe(true);
    playback.stop();
    expect(players[0].removed).toBe(true);
    players[0].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
    await flush();
    expect(players).toHaveLength(1);
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });
});

describe('chunkProgress', () => {
  test('weights pieces by length and clamps', () => {
    expect(chunkProgress([10, 30], 0, 1)).toBeCloseTo(0.25);
    expect(chunkProgress([10, 30], 1, 0.5)).toBeCloseTo(0.625);
    expect(chunkProgress([10, 30], 1, 7)).toBe(1);
    expect(chunkProgress([], 0, 0.5)).toBe(0);
  });
});
