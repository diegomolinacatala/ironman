/** Audio cache of the natural voice: only Aura MP3 is cached; MeloTTS WAV goes to a temporary file. */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn() },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `h(${value})`,
}));

jest.mock('expo-file-system', () => {
  const store = new Map<string, string>();
  const join = (parent: { uri: string }, name: string) => `${parent.uri}/${name}`;
  class File {
    uri: string;
    modificationTime = 0;
    constructor(parent: { uri: string }, name: string) {
      this.uri = join(parent, name);
    }
    get exists() {
      return store.has(this.uri);
    }
    async write(content: string) {
      store.set(this.uri, content);
    }
    delete() {
      store.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = join(parent, name);
    }
    create() {
      return undefined;
    }
    list() {
      return [...store.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
        .map((uri) => {
          const file = Object.create(File.prototype) as File;
          file.uri = uri;
          file.modificationTime = 0;
          return file;
        });
    }
  }
  return { File, Directory, Paths: { cache: { uri: 'cache' } }, store };
});

const { store } = jest.requireMock<{ store: Map<string, string> }>('expo-file-system');

import { cachedAudioUri, resetNeuralCacheForTests } from '../speech/neuralSpeech';

beforeEach(() => {
  store.clear();
  resetNeuralCacheForTests();
});

describe('cachedAudioUri', () => {
  test('caches the natural voice (MP3) and reuses it without asking again', async () => {
    const synthesize = jest.fn(async () => ({ audio: 'SUQz', mime: 'audio/mpeg' as const }));
    const first = await cachedAudioUri('Hola.', 'nestor', synthesize);
    expect(first).toBe('cache/speech/h(v2|nestor|Hola.).mp3');
    expect(store.get(first!)).toBe('SUQz');
    await expect(cachedAudioUri('Hola.', 'nestor', synthesize)).resolves.toBe(first);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  test('fallback audio (WAV) is played from a temporary file and never reused as the voice', async () => {
    const synthesize = jest.fn(async () => ({ audio: 'UklG', mime: 'audio/wav' as const }));
    const uri = await cachedAudioUri('Hola.', 'nestor', synthesize);
    expect(uri).toMatch(/^cache\/speech-tmp\//);
    expect(uri).toMatch(/\.wav$/);
    await cachedAudioUri('Hola.', 'nestor', synthesize);
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect([...store.keys()].some((key) => key.startsWith('cache/speech/'))).toBe(false);
  });

  test('old WAVs cached under a voice key and temporary files are removed on the first use', async () => {
    store.set('cache/speech/old.wav', 'x');
    store.set('cache/speech-tmp/a-1.wav', 'x');
    store.set('cache/speech/keep.mp3', 'x');
    await cachedAudioUri('Hola.', 'nestor', jest.fn(async () => null));
    expect(store.has('cache/speech/old.wav')).toBe(false);
    expect(store.has('cache/speech-tmp/a-1.wav')).toBe(false);
    expect(store.has('cache/speech/keep.mp3')).toBe(true);
  });

  test('nothing synthesised → null', async () => {
    await expect(cachedAudioUri('Hola.', 'nestor', jest.fn(async () => null))).resolves.toBeNull();
  });
});
