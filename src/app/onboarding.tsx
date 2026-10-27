import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '@/data/context';
import { useProfile } from '@/data/queries';
import { OnboardingFlow } from '@/features/onboarding/OnboardingFlow';
import { ErrorNotice, Loading, Screen } from '@/ui';

/** v2 guided onboarding (everyone goes through it once; the v2 migration resets `onboardedAt`). */
export default function OnboardingScreen() {
  const { session, mode } = useAuth();
  const profile = useProfile();
  // Set when the last step saves `onboardedAt`: from then on it is ours, not a reason to leave.
  const [finishing, setFinishing] = useState(false);
  // Already onboarded (stale link, second device): never re-run the flow over a finished profile.
  const alreadyOnboarded = Boolean(profile.data?.onboardedAt) && !finishing;
  const signedOut = !session;

  useEffect(() => {
    if (signedOut) router.replace('/sign-in');
    else if (alreadyOnboarded) router.replace('/today');
  }, [signedOut, alreadyOnboarded]);

  if (profile.isLoading || alreadyOnboarded || signedOut) {
    return (
      <Screen scroll={false}>
        <Loading label="Preparando tu perfil" />
      </Screen>
    );
  }
  // A failed load must not fall through to an empty flow: saving it would overwrite the real profile.
  if (!profile.data) {
    return (
      <Screen scroll={false}>
        <ErrorNotice message="No hemos podido cargar tu perfil. Revisa tu conexión." onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }

  return (
    <OnboardingFlow
      profile={profile.data}
      userId={session.userId}
      isDemo={mode === 'demo'}
      onFinishing={() => setFinishing(true)}
    />
  );
}
