import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useUpdateProfile } from '@/data/queries';
import type { Profile } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { ErrorNotice, TextField, haptics, space } from '@/ui';

import { Appear } from '../Appear';
import { ValueLine } from '../GuideParts';
import { NAME_MAX, nameError, welcomePatches } from '../onboardingModel';
import { StepLayout, type StepNav } from '../StepLayout';

const VALUES = [
  { icon: 'watch', title: 'Lee tu Garmin', text: 'Sueño, VFC y entrenos, sin apuntar nada.' },
  { icon: 'calendarCheck', title: 'Vive en tu calendario', text: 'Tus entrenos aparecen entre tus planes, con aviso.' },
  { icon: 'mic', title: 'Le hablas y se adapta', text: 'Cuéntale un imprevisto y recoloca la semana.' },
] as const;

export interface WelcomeStepProps {
  nav: StepNav;
  profile: Profile;
}

/** Step 1: name (prefilled) + what the app does in three lines. */
export function WelcomeStep({ nav, profile }: WelcomeStepProps) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = nameError(name);

  const onNext = async () => {
    if (invalid) return;
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
      <View style={styles.values}>
        {VALUES.map((v, i) => (
          <ValueLine key={v.title} icon={v.icon} title={v.title} text={v.text} index={i + 2} />
        ))}
      </View>
      {error ? <ErrorNotice message={error} /> : null}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  values: { gap: space.lg },
});
