import type { ReactNode } from 'react';

import { useProfile } from '@/data/queries';
import type { Profile } from '@/domain/types';
import { errorMessage } from '@/lib/logger';
import { EmptyState, ErrorNotice, Loading, Screen } from '@/ui';

/**
 * Loads the profile and renders the loading / error / empty states for
 * settings screens; `children` receives the loaded profile.
 */
export function ProfileGate({ children }: { children: (profile: Profile) => ReactNode }) {
  const profile = useProfile();
  if (profile.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando" />
      </Screen>
    );
  }
  if (profile.isError) {
    return (
      <Screen inSheet>
        <ErrorNotice message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }
  if (!profile.data) {
    return (
      <Screen inSheet>
        <EmptyState icon="profile" title="Sin perfil" message="Inicia sesión y completa el registro." />
      </Screen>
    );
  }
  return <>{children(profile.data)}</>;
}
