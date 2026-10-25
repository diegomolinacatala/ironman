import { router } from 'expo-router';
import { useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { Profile, ProfilePatch } from '@/domain/types';
import { firstError, profilePatchSchema } from '@/domain/validation';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

export interface ProfileSave {
  save: (patch: ProfilePatch, options?: { goBack?: boolean }) => Promise<Profile | null>;
  saving: boolean;
  error: string | null;
  clearError: () => void;
}

/** Validates (zod) and saves a profile patch; optionally pops the screen on success. */
export function useProfileSave(): ProfileSave {
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: ProfilePatch, options: { goBack?: boolean } = {}): Promise<Profile | null> => {
    const parsed = profilePatchSchema.safeParse(patch);
    if (!parsed.success) {
      setError(firstError(parsed) ?? 'Revisa los datos');
      haptics.warning();
      return null;
    }
    setError(null);
    try {
      const profile = await update.mutateAsync(patch);
      haptics.success();
      if (options.goBack && router.canGoBack()) router.back();
      return profile;
    } catch (err) {
      logger.warn('profile save failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No se pudo guardar. Inténtalo de nuevo.'));
      return null;
    }
  };

  return { save, saving: update.isPending, error, clearError: () => setError(null) };
}
