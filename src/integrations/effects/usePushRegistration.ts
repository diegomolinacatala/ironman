/**
 * Registers the Expo push token once per signed-in account. Signing out forgets
 * who was registered, so the same account signing back in registers again (the
 * data layer unregisters the token on sign-out).
 */
import { useEffect, useRef } from 'react';

import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';

import { registerForPush } from '../notifications';

/**
 * @param enabled signed in, onboarded and on a native platform
 * @param userId the signed-in account, null when signed out
 */
export function usePushRegistration(enabled: boolean, userId: string | null, repo: Repository): void {
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      registeredFor.current = null;
      return;
    }
    if (!enabled || registeredFor.current === userId) return;
    registeredFor.current = userId;
    registerForPush(repo)
      .then((token) => logger.debug(token ? 'push: registered' : 'push: not registered'))
      .catch((error: unknown) => logger.warn('push: registration failed', error));
  }, [enabled, userId, repo]);
}
