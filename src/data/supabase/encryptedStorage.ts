/**
 * supabase-js session storage that keeps values encrypted at rest — the
 * "LargeSecureStore" pattern from Supabase's Expo guide: the session JSON is
 * too big for the Keychain (~2 KB), so it lives in AsyncStorage sealed with
 * AES-256-GCM, and only the key lives in the Keychain (see `sessionCipher`).
 * A plain value written before this adapter existed is re-encrypted on first
 * read. Pure apart from the injected store and cipher.
 */
import { logger } from '@/lib/logger';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SessionCipher {
  encrypt(plaintext: string): Promise<string>;
  /** Throws when the payload cannot be authenticated (wrong or lost key, tampering). */
  decrypt(payload: string): Promise<string>;
}

/** The key store cannot be read right now (e.g. device not unlocked since boot): keep the data, retry later. */
export class CipherUnavailableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CipherUnavailableError';
    this.cause = cause;
  }
}

export const ENCRYPTED_PREFIX = 'enc.v1:';

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function createEncryptedStorage(store: KeyValueStore, cipher: SessionCipher): KeyValueStore {
  async function setItem(key: string, value: string): Promise<void> {
    const sealed = await cipher.encrypt(value);
    await store.setItem(key, `${ENCRYPTED_PREFIX}${sealed}`);
  }

  async function migrate(key: string, plain: string): Promise<string> {
    try {
      await setItem(key, plain);
    } catch (error) {
      // Keep the plain value (no forced sign-out); the next read tries again.
      logger.warn('session storage: could not encrypt the existing session', error instanceof Error ? error.name : undefined);
    }
    return plain;
  }

  async function decrypt(key: string, stored: string): Promise<string | null> {
    try {
      return await cipher.decrypt(stored.slice(ENCRYPTED_PREFIX.length));
    } catch (error) {
      if (error instanceof CipherUnavailableError) {
        logger.warn('session storage: key not readable yet; keeping the session for later');
        return null;
      }
      // Undecryptable for good (key lost, e.g. backup restored on another device): sign in again.
      logger.warn('session storage: stored session cannot be decrypted; discarding it');
      await store.removeItem(key);
      return null;
    }
  }

  return {
    async getItem(key) {
      const stored = await store.getItem(key);
      if (stored === null) return null;
      return isEncryptedValue(stored) ? decrypt(key, stored) : migrate(key, stored);
    },
    setItem,
    removeItem: (key) => store.removeItem(key),
  };
}
