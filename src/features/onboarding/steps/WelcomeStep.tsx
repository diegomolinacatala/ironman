import { useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { Profile } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { ErrorNotice, TextField, haptics } from '@/ui';

import { Appear } from '../Appear';
import { NAME_MAX, nameError, welcomePatches } from '../onboardingModel';
import { StepLayout, type StepNav } from '../StepLayout';

export interface WelcomeStepProps {
  nav: StepNav;
  profile: Profile;
}

/** The first step only asks for the name, prefilled when available. */
export function WelcomeStep({ nav, profile }: WelcomeStepProps) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = nameError(name);

  const onNext = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    const attempts = welcomePatches(profile, name);
    let lastError: unknown = null;
    for (const patch of attempts) {
      try {
        await update.mutateAsync(patch);
        lastError = null;
        break;
      } catch (err) {
        // A taken suggested username falls through to the next attempt (name only).
        logger.warn('onboarding: save name failed', err);
        lastError = err;
      }
    }
    setSaving(false);
    if (lastError) {
      haptics.warning();
      setError(errorMessage(lastError, 'No hemos podido guardar tu nombre. Inténtalo de nuevo.'));
      return;
    }
    nav.next();
  };

  return (
    <StepLayout
      nav={nav}
      busy={saving}
      primary={{ label: 'Empezar', iconRight: 'arrowRight', onPress: () => void onNext(), disabled: Boolean(invalid), loading: saving }}>
      <Appear index={1}>
        <TextField
          label="¿Cómo te llamas?"
          value={name}
          onChangeText={setName}
          placeholder="Tu nombre"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="givenName"
          returnKeyType="done"
          maxLength={NAME_MAX}
          onSubmitEditing={() => void onNext()}
        />
      </Appear>
      {error ? <ErrorNotice message={error} /> : null}
    </StepLayout>
  );
}

