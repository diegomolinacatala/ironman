/**
 * Natural-voice playback: sentence-sized pieces synthesised by the `speech` edge function
 * (Deepgram Aura-2 via Workers AI) and played back to back with expo-audio 58.
 *
 * - Starts as soon as the first (short) piece is ready, ~1 s; the next two are fetched while
 *   the current one plays.
 * - Every piece is cached on the device (`Paths.cache/speech/<sha256>.mp3|wav`), so listening to
 *   the briefing again costs nothing and needs no network. The system may purge that folder;
 *   we also keep at most `CACHE_MAX_FILES`.
 * - When a piece cannot be synthesised or played, `onFallback` hands the rest of the text to
 *   the device voice, so the coach never goes silent.
 * - Audio session: `playback` + duck other audio, also with the silent switch on (like the
 *   device voice, see `audioSession.ts`).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { SpeechAudio, SpeechVoice } from '@/domain/types';
import { logger } from '@/lib/logger';

import { prepareSpeechPlayback } from './audioSession';

export type Synthesize = (input: { text: string; voice: SpeechVoice }) => Promise<SpeechAudio | null>;

export interface NeuralCallbacks {
  /** The first piece started playing (the voice is really the natural one). */
  onStart: () => void;
  /** 0..1 over the whole text, weighted by characters. */
  onProgress: (progress: number) => void;
  onDone: () => void;
  /** Piece `index` failed: speak `rest` with the device voice. `progress` = share already spoken. */
  onFallback: (rest: string, progress: number) => void;
}

export interface NeuralPlayback {
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/** Minimal surface of expo-audio's AudioPlayer that we use (lets tests pass a fake). */
export interface PlayerLike {
  play: () => void;
  pause: () => void;
  remove: () => void;
  addListener: (event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void) => { remove: () => void };
}

export interface NeuralDeps {
  createPlayer: (uri: string) => PlayerLike;
  /** Local URI of the audio of `text` (cached), or null when it cannot be synthesised. */
  audioUri: (text: string, voice: SpeechVoice, synthesize: Synthesize) => Promise<string | null>;
  prepareAudio: () => Promise<void>;
}

const PREFETCH_AHEAD = 2;
const CACHE_DIR = 'speech';
const CACHE_MAX_FILES = 160;
/** Bump when the voice or the text preparation changes, so old audio is not reused. */
const CACHE_VERSION = 'v1';

const EXTENSION: Record<SpeechAudio['mime'], string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

let cacheTrimmed = false;

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR);
  dir.create({ idempotent: true, intermediates: true });
  if (!cacheTrimmed) {
    cacheTrimmed = true;
    trimCache(dir);
  }
  return dir;
}

/** Keeps the newest `CACHE_MAX_FILES` files (best effort). */
function trimCache(dir: Directory): void {
  try {
    const files = dir.list().filter((entry): entry is File => entry instanceof File);
    if (files.length <= CACHE_MAX_FILES) return;
    files
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
      .slice(CACHE_MAX_FILES)
      .forEach((file) => file.delete());
  } catch (error) {
    logger.debug('speech: could not trim the audio cache', error);
  }
}

async function cachedAudioUri(text: string, voice: SpeechVoice, synthesize: Synthesize): Promise<string | null> {
  if (Platform.OS === 'web') {
    const audio = await synthesize({ text, voice });
    return audio ? `data:${audio.mime};base64,${audio.audio}` : null;
  }
  const key = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${CACHE_VERSION}|${voice}|${text}`);
  const dir = cacheDirectory();
  for (const extension of Object.values(EXTENSION)) {
    const cached = new File(dir, `${key}.${extension}`);
    if (cached.exists) return cached.uri;
  }
  const audio = await synthesize({ text, voice });
  if (!audio) return null;
  const file = new File(dir, `${key}.${EXTENSION[audio.mime]}`);
  await file.write(audio.audio, { encoding: 'base64' });
  return file.uri;
}

async function prepareAudio(): Promise<void> {
  prepareSpeechPlayback();
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', allowsRecording: false, shouldPlayInBackground: false });
  } catch (error) {
    logger.debug('speech: could not set the audio mode', error);
  }
}

const defaultDeps: NeuralDeps = {
  createPlayer: (uri) => createAudioPlayer({ uri }),
  audioUri: cachedAudioUri,
  prepareAudio,
};

/** Share of the text (by characters) covered by pieces before `index`, plus `fraction` of piece `index`. */
export function chunkProgress(lengths: readonly number[], index: number, fraction: number): number {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return 0;
  const before = lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
  const current = (lengths[index] ?? 0) * Math.max(0, Math.min(1, fraction));
  return Math.max(0, Math.min(1, (before + current) / total));
}

/** Plays `chunks` with the natural `voice`. */
export function playNeural(
  chunks: readonly string[],
  voice: SpeechVoice,
  synthesize: Synthesize,
  callbacks: NeuralCallbacks,
  deps: NeuralDeps = defaultDeps,
): NeuralPlayback {
  const lengths = chunks.map((chunk) => chunk.length);
  const pending = new Map<number, Promise<string | null>>();
  let cancelled = false;
  let paused = false;
  let started = false;
  let index = 0;
  let player: PlayerLike | null = null;
  let subscription: { remove: () => void } | null = null;
  /** Piece ready while paused: start it on resume. */
  let waiting: (() => void) | null = null;

  const ensure = (i: number): Promise<string | null> | undefined => {
    if (i < 0 || i >= chunks.length) return undefined;
    let promise = pending.get(i);
    if (!promise) {
      promise = deps.audioUri(chunks[i], voice, synthesize).catch((error: unknown) => {
        logger.warn('speech: natural voice unavailable', error instanceof Error ? error.message : error);
        return null;
      });
      pending.set(i, promise);
    }
    return promise;
  };

  const release = () => {
    subscription?.remove();
    subscription = null;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch (error) {
        logger.debug('speech: could not release the player', error);
      }
    }
    player = null;
  };

  const fallBack = (i: number) => {
    if (cancelled) return;
    cancelled = true;
    release();
    callbacks.onFallback(chunks.slice(i).join(' '), chunkProgress(lengths, i, 0));
  };

  const startChunk = (i: number, uri: string) => {
    if (cancelled) return;
    release();
    try {
      player = deps.createPlayer(uri);
    } catch (error) {
      logger.warn('speech: could not create the audio player', error);
      fallBack(i);
      return;
    }
    subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (cancelled || i !== index) return;
      if (status.error) {
        logger.warn('speech: playback failed', status.error);
        fallBack(i);
        return;
      }
      if (status.duration > 0) callbacks.onProgress(chunkProgress(lengths, i, status.currentTime / status.duration));
      if (status.didJustFinish) void playFrom(i + 1);
    });
    player.play();
    if (!started) {
      started = true;
      callbacks.onStart();
    }
    for (let ahead = 1; ahead <= PREFETCH_AHEAD; ahead += 1) void ensure(i + ahead);
  };

  const playFrom = async (i: number): Promise<void> => {
    if (cancelled) return;
    index = i;
    if (i >= chunks.length) {
      cancelled = true;
      release();
      callbacks.onProgress(1);
      callbacks.onDone();
      return;
    }
    const uri = await ensure(i);
    if (cancelled || i !== index) return;
    if (!uri) {
      fallBack(i);
      return;
    }
    if (paused) {
      waiting = () => startChunk(i, uri);
      return;
    }
    startChunk(i, uri);
  };

  for (let i = 0; i <= PREFETCH_AHEAD; i += 1) void ensure(i);
  void deps
    .prepareAudio()
    .catch(() => undefined)
    .then(() => playFrom(0));

  return {
    pause: () => {
      paused = true;
      player?.pause();
    },
    resume: () => {
      paused = false;
      const start = waiting;
      waiting = null;
      if (start) start();
      else player?.play();
    },
    stop: () => {
      cancelled = true;
      waiting = null;
      release();
    },
  };
}

/** Test hook. */
export function resetNeuralCacheForTests(): void {
  cacheTrimmed = false;
}
