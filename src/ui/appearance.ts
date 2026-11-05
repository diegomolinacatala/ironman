/**
 * Appearance preference: follow the system, or force light / dark.
 *
 * Stored on the device (AsyncStorage). On native the override is also pushed to
 * `Appearance.setColorScheme` so native chrome (tab bar, headers, alerts, date pickers)
 * follows the same scheme as our own components.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'rti.appearance';
const PREFERENCES: readonly AppearancePreference[] = ['system', 'light', 'dark'];

let current: AppearancePreference = 'system';
/** True once the user picked a scheme in this session: a late startup read must not undo it. */
let chosenThisSession = false;
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is AppearancePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

function applyNative(preference: AppearancePreference): void {
  if (Platform.OS === 'web') return;
  try {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Older runtimes without the override: our own components still follow `current`.
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppearancePreference(): AppearancePreference {
  return current;
}

/** Sets (and persists) the preference. Storage failures keep the in-memory choice. */
export async function setAppearancePreference(preference: AppearancePreference): Promise<void> {
  current = preference;
  chosenThisSession = true;
  applyNative(preference);
  emit();
  try {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Not persisted: the choice still applies until the app closes.
  }
}

/** Reads the stored preference once at startup. */
export async function loadAppearancePreference(): Promise<AppearancePreference> {
  try {
    const stored = await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!chosenThisSession && isPreference(stored) && stored !== current) {
      current = stored;
      applyNative(stored);
      emit();
    }
  } catch {
    // Keep the default ('system').
  }
  return current;
}

export function useAppearancePreference(): AppearancePreference {
  return useSyncExternalStore(subscribe, getAppearancePreference, getAppearancePreference);
}

/** The scheme the app should render with right now. */
export function useResolvedColorScheme(): ColorScheme {
  const preference = useAppearancePreference();
  const system = useColorScheme();
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

/** Test helper: back to the default without touching storage. */
export function resetAppearanceForTests(): void {
  current = 'system';
  chosenThisSession = false;
  emit();
}
