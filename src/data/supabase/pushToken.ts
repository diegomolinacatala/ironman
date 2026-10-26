/**
 * Detaches this device's APNs push token from the signed-in account before it
 * signs out or is deleted, so the old account's pushes stop reaching a phone
 * that someone else may now hold. Best effort: never blocks sign-out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import { removeKey, StorageKeys } from '@/lib/storage';

import { isRecord } from './narrow';

/** RPC / PostgREST codes meaning "the function is not deployed yet". */
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883']);

/** `registerForPush` stores the token with `writeJson` (a JSON string); a raw string is tolerated. */
export function parseStoredPushToken(raw: string | null): string | null {
  if (raw === null) return null;
  let value: unknown = raw;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    // Not JSON: use the raw text.
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

async function readStoredPushToken(): Promise<string | null> {
  try {
    return parseStoredPushToken(await AsyncStorage.getItem(StorageKeys.pushToken));
  } catch (error) {
    logger.warn('push token: read failed', error);
    return null;
  }
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

async function deleteOnServer(client: SupabaseClient, token: string): Promise<void> {
  const { error } = await client.rpc('unregister_push_token', { p_token: token });
  if (!error) return;
  const code = errorCode(error);
  if (code === null || !MISSING_FUNCTION_CODES.has(code)) {
    logger.warn('push token: unregister failed', { code });
    return;
  }
  // Older backend without the RPC: RLS `push_tokens_delete_own` allows deleting our own row.
  const fallback = await client.from('push_tokens').delete().eq('token', token);
  if (fallback.error) logger.warn('push token: delete fallback failed', { code: errorCode(fallback.error) });
}

/**
 * Unregisters the stored push token for the current user and forgets it
 * locally (the next sign-in registers it again). Never throws.
 */
export async function unregisterStoredPushToken(client: SupabaseClient): Promise<void> {
  const token = await readStoredPushToken();
  if (!token) return;
  try {
    await deleteOnServer(client, token);
  } catch (error) {
    logger.warn('push token: unregister threw', { code: errorCode(error) });
  }
  await removeKey(StorageKeys.pushToken);
}
