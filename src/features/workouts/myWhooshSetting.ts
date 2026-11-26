/**
 * «Entreno en rodillo con MyWhoosh» (Tú › Entrenamiento): when on, every bike
 * session shows the closest free MyWhoosh workout (`domain/mywhoosh.ts`). Off by
 * default and stored on the device, like the appearance and the coach voice.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { logger } from '@/lib/logger';

export const MYWHOOSH_STORAGE_KEY = 'rti.myWhoosh.v1';

let enabled = false;
let loading: Promise<boolean> | null = null;
/** A choice made before the stored value was read wins over it. */
let chosenThisSession = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMyWhooshEnabled(): boolean {
  return enabled;
}

/** Reads the stored choice once (later calls reuse it). Never throws. */
export function loadMyWhooshEnabled(): Promise<boolean> {
  loading ??= AsyncStorage.getItem(MYWHOOSH_STORAGE_KEY)
    .then((stored) => {
      if (!chosenThisSession && (stored === '1') !== enabled) {
        enabled = stored === '1';
        emit();
      }
      return enabled;
    })
    .catch((error: unknown) => {
      logger.debug('mywhoosh: could not read the setting', error);
      return enabled;
    });
  return loading.then(() => enabled);
}

/** Turns the suggestion on or off (a storage failure keeps the choice until the app closes). */
export async function setMyWhooshEnabled(value: boolean): Promise<void> {
  enabled = value;
  chosenThisSession = true;
  emit();
  try {
    await AsyncStorage.setItem(MYWHOOSH_STORAGE_KEY, value ? '1' : '0');
  } catch (error) {
    logger.debug('mywhoosh: could not save the setting', error);
  }
}

/** The setting, read from the device on first use. */
export function useMyWhooshEnabled(): boolean {
  useEffect(() => {
    void loadMyWhooshEnabled();
  }, []);
  return useSyncExternalStore(subscribe, getMyWhooshEnabled, getMyWhooshEnabled);
}

/** Test helper: back to the default without touching storage. */
export function resetMyWhooshForTests(): void {
  enabled = false;
  loading = null;
  chosenThisSession = false;
  emit();
}
