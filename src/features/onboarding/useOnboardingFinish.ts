import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { useCreateRace, useUpdateProfile } from '@/data/queries';
import type { Thresholds } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { buildProfilePatch, raceDraftFromInput, type OnboardingState } from './onboardingModel';

export interface OnboardingFinish {
  finish: (state: OnboardingState) => Promise<void>;
  saving: boolean;
  error: string | null;
  /** Profile saved but the race was not: the user can continue anyway. */
  warning: string | null;
}

/**
 * Saves everything collected (profile + `onboardedAt`, then the optional race)
 * and goes to Hoy. A failed race does not block: it is reported as a warning.
 */
export function useOnboardingFinish(baseThresholds: Thresholds | undefined): OnboardingFinish {
  const updateProfile = useUpdateProfile();
  const createRace = useCreateRace();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const profileSaved = useRef(false);

  const finish = async (state: OnboardingState) => {
    if (profileSaved.current && warning) {
      router.replace('/today');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfile.mutateAsync(buildProfilePatch(state, new Date().toISOString(), baseThresholds));
      profileSaved.current = true;
    } catch (err) {
      logger.warn('onboarding profile save failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No pudimos guardar tu perfil. Inténtalo de nuevo.'));
      setSaving(false);
      return;
    }
    const race = raceDraftFromInput(state.race);
    if (race) {
      try {
        await createRace.mutateAsync(race);
      } catch (err) {
        logger.warn('onboarding race save failed', err);
        setWarning(`Tu perfil está guardado, pero la carrera no (${errorMessage(err)}). Añádela luego en Yo → Carreras.`);
        setSaving(false);
        return;
      }
    }
    haptics.success();
    setSaving(false);
    router.replace('/today');
  };

  return { finish, saving, error, warning };
}
