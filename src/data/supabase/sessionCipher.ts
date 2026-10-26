/**
 * AES-256-GCM cipher for the Supabase session (native platform crypto through
 * expo-crypto: CryptoKit on iOS). The key is generated once with the platform
 * CSPRNG and kept in the Keychain (expo-secure-store) as
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: background token refresh keeps working,
 * and the key is excluded from backups and device migration, so a copied
 * backup holds only an undecryptable blob.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { logger } from '@/lib/logger';

import { CipherUnavailableError, createEncryptedStorage, type KeyValueStore, type SessionCipher } from './encryptedStorage';

export const SESSION_KEY_NAME = 'rti.session.aesKey';

const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function readStoredKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_KEY_NAME, KEY_OPTIONS);
  } catch (error) {
    // Never generate a replacement here: the key may exist but be locked.
    throw new CipherUnavailableError('session key not readable', error);
  }
}

async function importKey(hex: string): Promise<AESEncryptionKey | null> {
  try {
    return await AESEncryptionKey.import(hex, 'hex');
  } catch {
    logger.warn('session key is corrupted; generating a new one');
    return null;
  }
}

async function createKey(): Promise<AESEncryptionKey> {
  const key = await AESEncryptionKey.generate(AESKeySize.AES256);
  await SecureStore.setItemAsync(SESSION_KEY_NAME, await key.encoded('hex'), KEY_OPTIONS);
  return key;
}

async function loadOrCreateKey(): Promise<AESEncryptionKey> {
  const stored = await readStoredKey();
  const imported = stored ? await importKey(stored) : null;
  return imported ?? createKey();
}

export function createKeychainCipher(): SessionCipher {
  let pending: Promise<AESEncryptionKey> | null = null;
  const key = (): Promise<AESEncryptionKey> => {
    // One shared load (no duplicate keys from concurrent calls); retried after a failure.
    pending ??= loadOrCreateKey().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };

  return {
    async encrypt(plaintext) {
      const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), await key());
      return sealed.combined('base64');
    },
    async decrypt(payload) {
      const secret = await key();
      const bytes = await aesDecryptAsync(AESSealedData.fromCombined(payload), secret);
      return new TextDecoder().decode(bytes);
    },
  };
}

/** Session storage for native: encrypted blob in AsyncStorage, AES key in the Keychain. */
export function createSecureSessionStorage(): KeyValueStore {
  return createEncryptedStorage(AsyncStorage, createKeychainCipher());
}
