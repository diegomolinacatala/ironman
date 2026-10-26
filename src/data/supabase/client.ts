/**
 * Supabase client singleton (publishable key; RLS applies to everything).
 * Session persisted encrypted on native (AES-GCM blob in AsyncStorage, key in
 * the Keychain — see `sessionCipher`), plain AsyncStorage on web; token
 * auto-refresh only while the app is in the foreground on native (Supabase
 * recommendation for React Native).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import type { KeyValueStore } from './encryptedStorage';
import { createSecureSessionStorage } from './sessionCipher';

let client: SupabaseClient | null = null;

/** The Keychain (expo-secure-store) does not exist on web. */
function sessionStorage(): KeyValueStore {
  return Platform.OS === 'web' ? AsyncStorage : createSecureSessionStorage();
}
let appStateBound = false;

function bindAppStateRefresh(instance: SupabaseClient): void {
  if (appStateBound || Platform.OS === 'web') return;
  appStateBound = true;
  const onChange = (state: AppStateStatus): void => {
    if (state === 'active') void instance.auth.startAutoRefresh();
    else void instance.auth.stopAutoRefresh();
  };
  AppState.addEventListener('change', onChange);
  if (AppState.currentState === 'active') void instance.auth.startAutoRefresh();
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseKey) {
    logger.error('Supabase client requested without EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY');
  }
  client = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      storage: sessionStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Email links come back as roadtoironman://auth/callback?code=… and are exchanged on this device.
      flowType: 'pkce',
    },
  });
  bindAppStateRefresh(client);
  return client;
}
