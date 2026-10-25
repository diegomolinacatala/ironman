/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  CipherUnavailableError,
  ENCRYPTED_PREFIX,
  createEncryptedStorage,
  type KeyValueStore,
  type SessionCipher,
} from '../supabase/encryptedStorage';
import { SESSION_KEY_NAME, createSecureSessionStorage } from '../supabase/sessionCipher';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockKeychain = new Map<string, string>();
const mockKeychainState = { locked: false };
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 5,
  getItemAsync: jest.fn(async (key: string) => {
    if (mockKeychainState.locked) throw new Error('errSecInteractionNotAllowed');
    return mockKeychain.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
}));

/** expo-crypto's native AES-GCM stood in by Node's (same combined layout: iv ‖ ciphertext ‖ tag). */
jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual('crypto') as typeof import('crypto');
  class FakeKey {
    readonly raw: Buffer;
    constructor(bytes: Buffer) {
      this.raw = bytes;
    }
    static async generate(): Promise<FakeKey> {
      return new FakeKey(nodeCrypto.randomBytes(32));
    }
    static async import(hex: string): Promise<FakeKey> {
      if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('invalid key');
      return new FakeKey(Buffer.from(hex, 'hex'));
    }
    async encoded(): Promise<string> {
      return this.raw.toString('hex');
    }
  }
  class FakeSealed {
    readonly bytes: Buffer;
    constructor(combined: Buffer) {
      this.bytes = combined;
    }
    static fromCombined(base64: string): FakeSealed {
      return new FakeSealed(Buffer.from(base64, 'base64'));
    }
    async combined(): Promise<string> {
      return this.bytes.toString('base64');
    }
  }
  return {
    AESKeySize: { AES256: 256 },
    AESEncryptionKey: FakeKey,
    AESSealedData: FakeSealed,
    aesEncryptAsync: async (plain: Uint8Array, key: FakeKey) => {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return new FakeSealed(Buffer.concat([iv, body, cipher.getAuthTag()]));
    },
    aesDecryptAsync: async (sealed: FakeSealed, key: FakeKey) => {
      const b = sealed.bytes;
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(b.length - 16));
      return new Uint8Array(Buffer.concat([decipher.update(b.subarray(12, b.length - 16)), decipher.final()]));
    },
  };
});

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const STORAGE_KEY = 'sb-project-auth-token';
const SESSION_JSON = JSON.stringify({
  access_token: 'eyJhbGciOiJIUzI1NiJ9.access',
  refresh_token: 'refresh-secret-123',
  user: { id: 'u1', user_metadata: { full_name: 'Álex Muñoz' } },
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

/** Reversible stand-in cipher for the adapter logic (not crypto). */
const reverseCipher: SessionCipher = {
  encrypt: async (plain) => `x${[...plain].reverse().join('')}`,
  decrypt: async (payload) => {
    if (!payload.startsWith('x')) throw new Error('bad tag');
    return [...payload.slice(1)].reverse().join('');
  },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockKeychain.clear();
  mockKeychainState.locked = false;
  (SecureStore.setItemAsync as jest.Mock).mockClear();
});

describe('createEncryptedStorage', () => {
  it('stores values sealed and reads them back', async () => {
    const store = memoryStore();
    const storage = createEncryptedStorage(store, reverseCipher);
    await storage.setItem(STORAGE_KEY, SESSION_JSON);
    const raw = store.data.get(STORAGE_KEY) ?? '';
    expect(raw.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(raw).not.toContain('refresh-secret-123');
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION_JSON);
    await storage.removeItem(STORAGE_KEY);
    expect(await storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('migrates a plain session written before encryption', async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, SESSION_JSON);
    const storage = createEncryptedStorage(store, reverseCipher);
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION_JSON);
    expect(store.data.get(STORAGE_KEY)?.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION_JSON);
  });

  it('keeps the plain session when migration fails', async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, SESSION_JSON);
    const failing: SessionCipher = { ...reverseCipher, encrypt: async () => Promise.reject(new Error('no key')) };
    expect(await createEncryptedStorage(store, failing).getItem(STORAGE_KEY)).toBe(SESSION_JSON);
    expect(store.data.get(STORAGE_KEY)).toBe(SESSION_JSON);
  });

  it('discards a payload that cannot be decrypted', async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, `${ENCRYPTED_PREFIX}tampered`);
    expect(await createEncryptedStorage(store, reverseCipher).getItem(STORAGE_KEY)).toBeNull();
    expect(store.data.has(STORAGE_KEY)).toBe(false);
  });

  it('keeps the payload while the key is temporarily unreadable', async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, `${ENCRYPTED_PREFIX}xabc`);
    const locked: SessionCipher = { ...reverseCipher, decrypt: async () => Promise.reject(new CipherUnavailableError('locked')) };
    expect(await createEncryptedStorage(store, locked).getItem(STORAGE_KEY)).toBeNull();
    expect(store.data.get(STORAGE_KEY)).toBe(`${ENCRYPTED_PREFIX}xabc`);
  });
});

describe('createSecureSessionStorage (Keychain key + AES-GCM)', () => {
  it('round-trips UTF-8 sessions and never writes tokens in clear to AsyncStorage', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(STORAGE_KEY, SESSION_JSON);
    const raw = (await AsyncStorage.getItem(STORAGE_KEY)) ?? '';
    expect(raw.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(raw).not.toContain('refresh-secret-123');
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION_JSON);
    expect(await createSecureSessionStorage().getItem(STORAGE_KEY)).toBe(SESSION_JSON);
  });

  it('creates one AES key, kept in the Keychain as after-first-unlock, this device only', async () => {
    const storage = createSecureSessionStorage();
    await Promise.all([storage.setItem(STORAGE_KEY, 'a'), storage.setItem(`${STORAGE_KEY}-2`, 'b')]);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY_NAME, expect.stringMatching(/^[0-9a-f]{64}$/), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  });

  it('migrates an existing plain AsyncStorage session on first read', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, SESSION_JSON);
    expect(await createSecureSessionStorage().getItem(STORAGE_KEY)).toBe(SESSION_JSON);
    const raw = (await AsyncStorage.getItem(STORAGE_KEY)) ?? '';
    expect(raw.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(raw).not.toContain('refresh-secret-123');
  });

  it('treats a session restored without its Keychain key as signed out', async () => {
    await createSecureSessionStorage().setItem(STORAGE_KEY, SESSION_JSON);
    mockKeychain.clear(); // e.g. backup restored on another device: THIS_DEVICE_ONLY keys do not travel.
    expect(await createSecureSessionStorage().getItem(STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the session when the Keychain is locked, and reads it once unlocked', async () => {
    await createSecureSessionStorage().setItem(STORAGE_KEY, SESSION_JSON);
    const storage = createSecureSessionStorage();
    mockKeychainState.locked = true;
    expect(await storage.getItem(STORAGE_KEY)).toBeNull();
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    mockKeychainState.locked = false;
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION_JSON);
  });
});
