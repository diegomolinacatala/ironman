/** playNeural with fake players: order, prefetch, progress, pause while loading, fallback, stop. */
import { describe, expect, jest, test } from '@jest/globals';
import type { AudioStatus } from 'expo-audio';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn() },
}));

import { chunkProgress, playNeural, STALL_MS, type NeuralCallbacks, type NeuralDeps, type PlayerLike } from '../speech/neuralSpeech';

interface FakePlayer extends PlayerLike {
  uri: string;
  emit: (status: Partial<AudioStatus>) => void;
  playing: boolean;
  removed: boolean;
}

function setup(audio: Record<string, string | null | Promise<string | null>>) {
  const players: FakePlayer[] = [];
  const requested: string[] = [];
  const releaseAudio = jest.fn(async () => undefined);
  const deps: NeuralDeps = {
    prepareAudio: async () => undefined,
    releaseAudio,
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
    onInterrupted: jest.fn(),
  } satisfies NeuralCallbacks;
  return { deps, callbacks, players, requested, releaseAudio };
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
    await flush();
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

describe('playNeural: audio session, interruptions and pause', () => {
  test('stop, finish and fallback release expo-audio; stop resolves after it', async () => {
    const { deps, callbacks, releaseAudio } = setup({ 'Uno.': 'f1' });
    let releasedAt = 0;
    releaseAudio.mockImplementation(async () => {
      releasedAt += 1;
    });
    const playback = playNeural(['Uno.'], 'nestor', jest.fn(async () => null), callbacks, deps);
    await flush();
    await playback.stop();
    expect(releasedAt).toBe(1);
    await playback.stop();
    expect(releaseAudio).toHaveBeenCalledTimes(1);

    const done = setup({ 'Uno.': 'f1' });
    playNeural(['Uno.'], 'nestor', jest.fn(async () => null), done.callbacks, done.deps);
    await flush();
    done.players[0].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
    await flush();
    expect(done.releaseAudio).toHaveBeenCalledTimes(1);
    expect(done.callbacks.onDone).toHaveBeenCalledTimes(1);

    const failing = setup({});
    playNeural(['Uno.'], 'nestor', jest.fn(async () => null), failing.callbacks, failing.deps);
    await flush();
    expect(failing.releaseAudio).toHaveBeenCalledTimes(1);
    expect(failing.callbacks.onFallback).toHaveBeenCalledTimes(1);
  });

  test('a fallback due while paused waits for resume (and never happens after stop)', async () => {
    const { deps, callbacks, players } = setup({ 'Uno.': 'f1', 'Dos.': null });
    const playback = playNeural(['Uno.', 'Dos.'], 'nestor', jest.fn(async () => null), callbacks, deps);
    await flush();
    playback.pause();
    players[0].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
    await flush();
    expect(callbacks.onFallback).not.toHaveBeenCalled();
    playback.resume();
    await flush();
    expect(callbacks.onFallback).toHaveBeenCalledWith('Dos.', chunkProgress([4, 4], 1, 0));

    const stopped = setup({ 'Uno.': 'f1', 'Dos.': null });
    const other = playNeural(['Uno.', 'Dos.'], 'nestor', jest.fn(async () => null), stopped.callbacks, stopped.deps);
    await flush();
    other.pause();
    stopped.players[0].emit({ didJustFinish: true, duration: 1, currentTime: 1 });
    await flush();
    await other.stop();
    other.resume();
    await flush();
    expect(stopped.callbacks.onFallback).not.toHaveBeenCalled();
  });

  test('a system pause (call, Siri) that lasts is reported as an interruption; resume plays on', async () => {
    jest.useFakeTimers();
    try {
      const { deps, callbacks, players } = setup({ 'Uno.': 'f1' });
      const playback = playNeural(['Uno.'], 'nestor', jest.fn(async () => null), callbacks, deps);
      await jest.runOnlyPendingTimersAsync();
      await Promise.resolve();
      players[0].emit({ playing: true, currentTime: 1, duration: 5 });
      players[0].playing = false;
      players[0].emit({ playing: false, currentTime: 1.2, duration: 5 });
      jest.advanceTimersByTime(STALL_MS + 10);
      expect(callbacks.onInterrupted).toHaveBeenCalledTimes(1);
      playback.resume();
      expect(players[0].playing).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the end of a piece and a short hiccup are not interruptions', async () => {
    jest.useFakeTimers();
    try {
      const { deps, callbacks, players } = setup({ 'Uno.': 'f1', 'Dos.': 'f2' });
      playNeural(['Uno.', 'Dos.'], 'nestor', jest.fn(async () => null), callbacks, deps);
      await jest.runOnlyPendingTimersAsync();
      await Promise.resolve();
      players[0].emit({ playing: true, currentTime: 1, duration: 5 });
      players[0].emit({ playing: false, currentTime: 4.9, duration: 5 });
      jest.advanceTimersByTime(STALL_MS + 10);
      players[0].emit({ playing: false, currentTime: 2, duration: 5 });
      players[0].emit({ playing: true, currentTime: 2.1, duration: 5 });
      jest.advanceTimersByTime(STALL_MS + 10);
      expect(callbacks.onInterrupted).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
