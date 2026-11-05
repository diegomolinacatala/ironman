/**
 * Natural-voice playback: sentence-sized pieces synthesised by the `speech` edge function
 * (Deepgram Aura-2 via Workers AI) and played back to back with expo-audio 58.
 *
 * - Starts as soon as the first (short) piece is ready, ~1 s; the next two are fetched while
 *   the current one plays.
 * - Aura pieces (MP3) are cached on the device (`Paths.cache/speech/<sha256>.mp3`), so listening
 *   to the briefing again costs nothing and needs no network. Fallback audio (MeloTTS WAV, used
 *   when the day's Aura budget is spent) is played from a temporary file and never cached, so it
 *   cannot replace the chosen voice later. At most `CACHE_MAX_FILES` are kept.
 * - When a piece cannot be synthesised or played, `onFallback` hands the rest of the text to
 *   the device voice, so the coach never goes silent (held while paused).
 * - Audio session: `playback` + duck other audio, also with the silent switch on. expo-audio
 *   deactivates the shared AVAudioSession ~100 ms after a pause / finish on its own queue; if
 *   dictation or the device voice started in that window it would be cut. So every stop, finish
 *   and fallback marks expo-audio inactive (`setIsAudioActiveAsync(false)`, which turns that
 *   pending deactivation into a no-op) and `stop()` resolves once that is done; the next playback
 *   re-enables it first.
 * - A phone call / Siri pauses the player without telling us: a stall that lasts
 *   `STALL_MS` is reported as `onInterrupted` (the UI shows "paused"; resume plays on).
 */
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioStatus } from 'expo-audio';
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
  /** Piece failed: speak `rest` with the device voice. `progress` = share already spoken. */
  onFallback: (rest: string, progress: number) => void;
  /** The system paused playback (call, Siri, route change): show it as paused. */
  onInterrupted?: () => void;
}

export interface NeuralPlayback {
  pause: () => void;
  resume: () => void;
  /** Silences it; resolves once the audio session is released (safe to start dictation). */
  stop: () => Promise<void>;
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
  /** Local URI of the audio of `text` (cached when it is the natural voice), or null. */
  audioUri: (text: string, voice: SpeechVoice, synthesize: Synthesize) => Promise<string | null>;
  prepareAudio: () => Promise<void>;
  /** Marks expo-audio's session inactive (cancels its delayed deactivation). */
  releaseAudio: () => Promise<void>;
}

const PREFETCH_AHEAD = 2;
const CACHE_DIR = 'speech';
const TEMP_DIR = 'speech-tmp';
const CACHE_MAX_FILES = 160;
/** Bump when the voice or the text preparation changes, so old audio is not reused. v2: MP3 only. */
const CACHE_VERSION = 'v2';
/** Natural voice = Aura-2 MP3; anything else (MeloTTS WAV) is a fallback and is not cached. */
const CACHEABLE_MIME: SpeechAudio['mime'] = 'audio/mpeg';
const EXTENSION: Record<SpeechAudio['mime'], string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
/** A pause we did not ask for that lasts this long is an interruption, not a hiccup. */
export const STALL_MS = 700;
/** Status updates this close to the end are the piece finishing, not a stall. */
const END_TOLERANCE_S = 0.3;

let cachePrepared = false;
let tempCounter = 0;

function directory(name: string): Directory {
  const dir = new Directory(Paths.cache, name);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

function files(dir: Directory): File[] {
  return dir.list().filter((entry): entry is File => entry instanceof File);
}

/** Once per app run: keep the newest cached pieces, empty the temporary folder (best effort). */
function prepareCache(): void {
  if (cachePrepared) return;
  cachePrepared = true;
  try {
    const cached = files(directory(CACHE_DIR));
    cached
      .filter((file) => !file.uri.endsWith('.mp3'))
      .forEach((file) => file.delete());
    cached
      .filter((file) => file.uri.endsWith('.mp3'))
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
      .slice(CACHE_MAX_FILES)
      .forEach((file) => file.delete());
    files(directory(TEMP_DIR)).forEach((file) => file.delete());
  } catch (error) {
    logger.debug('speech: could not tidy the audio cache', error);
  }
}

/** Exported for tests. */
export async function cachedAudioUri(text: string, voice: SpeechVoice, synthesize: Synthesize): Promise<string | null> {
  if (Platform.OS === 'web') {
    const audio = await synthesize({ text, voice });
    return audio ? `data:${audio.mime};base64,${audio.audio}` : null;
  }
  prepareCache();
  const key = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${CACHE_VERSION}|${voice}|${text}`);
  const cached = new File(directory(CACHE_DIR), `${key}.mp3`);
  if (cached.exists) return cached.uri;
  const audio = await synthesize({ text, voice });
  if (!audio) return null;
  tempCounter += 1;
  const file =
    audio.mime === CACHEABLE_MIME ? cached : new File(directory(TEMP_DIR), `${key}-${tempCounter}.${EXTENSION[audio.mime]}`);
  await file.write(audio.audio, { encoding: 'base64' });
  return file.uri;
}

async function prepareAudio(): Promise<void> {
  prepareSpeechPlayback();
  try {
    await setIsAudioActiveAsync(true);
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', allowsRecording: false, shouldPlayInBackground: false });
  } catch (error) {
    logger.debug('speech: could not set the audio mode', error);
  }
}

async function releaseAudio(): Promise<void> {
  try {
    await setIsAudioActiveAsync(false);
  } catch (error) {
    logger.debug('speech: could not release expo-audio', error);
  }
}

const defaultDeps: NeuralDeps = {
  createPlayer: (uri) => createAudioPlayer({ uri }),
  audioUri: cachedAudioUri,
  prepareAudio,
  releaseAudio,
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
  /** Stopped, finished or handed to the device voice: nothing of ours may play any more. */
  let cancelled = false;
  let paused = false;
  let started = false;
  let index = 0;
  let player: PlayerLike | null = null;
  let subscription: { remove: () => void } | null = null;
  /** Piece ready (or fallback due) while paused: run it on resume. */
  let waiting: (() => void) | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let released: Promise<void> | null = null;

  const clearStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };

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

  const releasePlayer = () => {
    clearStall();
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

  /** Ends our use of the audio for good (idempotent). */
  const finishAudio = (): Promise<void> => {
    cancelled = true;
    waiting = null;
    releasePlayer();
    if (!released) released = deps.releaseAudio().catch(() => undefined);
    return released;
  };

  const fallBack = (i: number) => {
    if (cancelled) return;
    const rest = chunks.slice(i).join(' ');
    const progress = chunkProgress(lengths, i, 0);
    const hand = () => void finishAudio().then(() => callbacks.onFallback(rest, progress));
    releasePlayer();
    if (paused) {
      waiting = hand;
      return;
    }
    hand();
  };

  const watchStall = (i: number, status: AudioStatus, wasPlaying: boolean) => {
    const nearEnd = status.duration > 0 && status.currentTime >= status.duration - END_TOLERANCE_S;
    if (status.playing || status.didJustFinish || status.isBuffering || !wasPlaying || nearEnd || paused) {
      clearStall();
      return;
    }
    if (stallTimer) return;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (cancelled || paused || i !== index) return;
      paused = true;
      callbacks.onInterrupted?.();
    }, STALL_MS);
  };

  const startChunk = (i: number, uri: string) => {
    if (cancelled) return;
    releasePlayer();
    try {
      player = deps.createPlayer(uri);
    } catch (error) {
      logger.warn('speech: could not create the audio player', error);
      fallBack(i);
      return;
    }
    let wasPlaying = false;
    subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (cancelled || i !== index) return;
      if (status.error) {
        logger.warn('speech: playback failed', status.error);
        fallBack(i);
        return;
      }
      watchStall(i, status, wasPlaying);
      if (status.playing) wasPlaying = true;
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
      await finishAudio();
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
      clearStall();
      player?.pause();
    },
    resume: () => {
      paused = false;
      const start = waiting;
      waiting = null;
      if (start) start();
      else player?.play();
    },
    stop: () => finishAudio(),
  };
}

/** Test hook. */
export function resetNeuralCacheForTests(): void {
  cachePrepared = false;
  tempCounter = 0;
}
