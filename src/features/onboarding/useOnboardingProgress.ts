import { useCallback, useEffect, useState } from 'react';

import { readJson, removeKey, writeJson } from '@/lib/storage';

import { parseStoredProgress, type StoredProgress } from './onboardingModel';

/** Device-local, per account. Never holds secrets (the Claude URL stays in memory only). */
export function onboardingProgressKey(userId: string): string {
  return `rti.onboarding.v2.${userId}`;
}

export interface OnboardingProgress {
  loaded: boolean;
  saved: StoredProgress | null;
  save: (progress: StoredProgress) => void;
  clear: () => Promise<void>;
}

/** Resumable onboarding: the current step is stored per user in AsyncStorage. */
export function useOnboardingProgress(userId: string | null): OnboardingProgress {
  const [state, setState] = useState<{ loaded: boolean; saved: StoredProgress | null }>({ loaded: false, saved: null });

  useEffect(() => {
    let active = true;
    if (!userId) {
      setState({ loaded: true, saved: null });
      return undefined;
    }
    void readJson<unknown>(onboardingProgressKey(userId), null).then((value) => {
      if (active) setState({ loaded: true, saved: parseStoredProgress(value) });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    (progress: StoredProgress) => {
      if (userId) void writeJson(onboardingProgressKey(userId), progress);
    },
    [userId],
  );

  const clear = useCallback(async () => {
    if (userId) await removeKey(onboardingProgressKey(userId));
  }, [userId]);

  return { ...state, save, clear };
}
