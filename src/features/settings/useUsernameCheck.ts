import { useEffect, useState } from 'react';

import { useUsernameAvailable } from '@/data/queries';
import { firstError, usernameSchema } from '@/domain/validation';

const DEBOUNCE_MS = 400;

export function useDebouncedValue<T>(value: T, delayMs: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/** Spanish validation message for a username, or null when the shape is valid. */
export function validateUsername(username: string): string | null {
  const result = usernameSchema.safeParse(username);
  if (result.success) return null;
  return firstError(result) ?? 'Usuario no válido';
}

export interface UsernameCheck {
  /** Shape error (zod), shown immediately. */
  error: string | null;
  /** true/false once checked; undefined while typing/checking or on network error. */
  available: boolean | undefined;
  checking: boolean;
}

/**
 * Validates the username locally and checks availability on the server
 * (debounced). The user's own current username always counts as available.
 */
export function useUsernameCheck(username: string, currentUsername?: string | null): UsernameCheck {
  const error = username ? validateUsername(username) : 'Elige un nombre de usuario';
  const debounced = useDebouncedValue(username);
  const isOwn = Boolean(currentUsername) && username === currentUsername;
  const shouldQuery = !error && !isOwn && debounced === username;
  const query = useUsernameAvailable(shouldQuery ? debounced : '');

  if (error) return { error, available: undefined, checking: false };
  if (isOwn) return { error: null, available: true, checking: false };
  if (!shouldQuery || query.isFetching) return { error: null, available: undefined, checking: true };
  if (query.isError) return { error: null, available: undefined, checking: false };
  return { error: null, available: query.data, checking: false };
}
