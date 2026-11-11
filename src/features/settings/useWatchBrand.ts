import { useCallback, useEffect, useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { Profile, WatchBrand } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { watchBrandOf } from './watchBrand';

export interface WatchBrandChoice {
  brand: WatchBrand;
  saving: boolean;
  error: string | null;
  /** Shows the brand at once and saves it to the profile (back to the saved one if that fails). */
  choose: (brand: WatchBrand) => Promise<boolean>;
}

/** "Tu reloj" (onboarding, Conexiones): Garmin | COROS, saved as `profile.watchBrand`. */
export function useWatchBrand(profile: Pick<Profile, 'watchBrand'> | null | undefined): WatchBrandChoice {
  const update = useUpdateProfile();
  const saved = watchBrandOf(profile);
  const [pending, setPending] = useState<WatchBrand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const brand = pending ?? saved;

  // Once the profile carries the choice, it is the source of truth again.
  useEffect(() => {
    if (pending !== null && pending === saved) setPending(null);
  }, [pending, saved]);

  const { mutateAsync } = update;
  const choose = useCallback(
    async (next: WatchBrand): Promise<boolean> => {
      if (next === brand) return true;
      setPending(next);
      setError(null);
      try {
        await mutateAsync({ watchBrand: next });
        return true;
      } catch (err) {
        logger.warn('watch brand: save failed', err);
        haptics.warning();
        setPending((current) => (current === next ? null : current));
        setError(errorMessage(err, 'No hemos podido guardar tu reloj. Inténtalo de nuevo.'));
        return false;
      }
    },
    [brand, mutateAsync],
  );

  return { brand, saving: update.isPending, error, choose };
}
