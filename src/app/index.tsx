import { Redirect } from 'expo-router';

import { useAuth } from '@/data/context';
import { useProfile } from '@/data/queries';
import { ErrorNotice, Loading, Screen } from '@/ui';

/** Entry gate: sign-in → onboarding → tabs. */
export default function Index() {
  const { session, isLoading } = useAuth();
  const profile = useProfile();

  if (isLoading || (session && profile.isLoading)) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  // A failed load must never be mistaken for "not onboarded" (onboarding would overwrite the profile).
  if (profile.isError && !profile.data) {
    return (
      <Screen scroll={false}>
        <ErrorNotice
          message="No hemos podido cargar tu perfil. Revisa tu conexión."
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }
  if (profile.isSuccess && !profile.data?.onboardedAt) return <Redirect href="/onboarding" />;
  return <Redirect href="/today" />;
}
