/**
 * Remembered open/closed state of collapsible sections (`Disclosure`), per device.
 *
 * Read once at startup into memory so a section never flickers between states; writes are
 * fire-and-forget (a storage failure only means the choice is forgotten on the next launch).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';

export const DISCLOSURE_STORAGE_KEY = 'rti.disclosure.v1';

let state: Record<string, boolean> = {};
let loaded = false;
let loading: Promise<void> | null = null;
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

/** Parses the stored map; anything malformed is ignored. */
export function parseDisclosureState(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch {
    return {};
  }
}

/** Loads the remembered states (idempotent). */
export function loadDisclosureState(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= AsyncStorage.getItem(DISCLOSURE_STORAGE_KEY)
    .then((raw) => {
      // Choices made before the read finished win over the stored ones.
      state = { ...parseDisclosureState(raw), ...state };
    })
    .catch(() => undefined)
    .finally(() => {
      loaded = true;
      emit();
    });
  return loading;
}

export function getDisclosureOpen(key: string): boolean | undefined {
  return state[key];
}

export function setDisclosureOpen(key: string, open: boolean): void {
  state = { ...state, [key]: open };
  emit();
  AsyncStorage.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

/** Test helper: forget everything in memory. */
export function resetDisclosureState(): void {
  state = {};
  loaded = false;
  loading = null;
  emit();
}

/**
 * Open state of one section. Without a `key` nothing is remembered (plain local state is
 * handled by the caller); with a key the user's last choice wins over `defaultOpen`.
 */
export function useDisclosureOpen(key: string | undefined, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => (key ? state[key] : undefined),
    () => undefined,
  );
  const set = useCallback((open: boolean) => {
    if (key) setDisclosureOpen(key, open);
  }, [key]);
  return [stored ?? defaultOpen, set];
}
