import { useAuth } from '@/data/context';
import { useProfile } from '@/data/queries';
import { AccountActions } from '@/features/account/AccountActions';
import { MeHeader } from '@/features/account/MeHeader';
import { MeMenu } from '@/features/account/MeMenu';
import { PrivacyCard } from '@/features/account/PrivacyCard';
import { useWeekStats } from '@/features/account/useWeekStats';
import { errorMessage } from '@/lib/logger';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { EmptyState, ErrorNotice, Loading, Screen, SectionHeader } from '@/ui';

export default function MeScreen() {
  const { mode } = useAuth();
  const profile = useProfile();
  const stats = useWeekStats();
  const isDemo = mode === 'demo';
  const refresh = () => {
    void profile.refetch();
    stats.refetch();
  };

  if (profile.isLoading) {
    return (
      <Screen title="Yo">
        <Loading label="Cargando tu perfil" />
      </Screen>
    );
  }
  if (profile.isError) {
    return (
      <Screen title="Yo">
        <ErrorNotice message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
        <PrivacyLinkRow />
        <AccountActions isDemo={isDemo} />
      </Screen>
    );
  }
  if (!profile.data) {
    return (
      <Screen title="Yo">
        <EmptyState icon="profile" title="Sin perfil" message="Termina el registro para ver tu perfil." />
        <AccountActions isDemo={isDemo} />
      </Screen>
    );
  }

  return (
    <Screen overline="Tu cuenta" title="Yo" onRefresh={refresh} refreshing={profile.isRefetching}>
      <MeHeader profile={profile.data} stats={stats} isDemo={isDemo} />
      <MeMenu profile={profile.data} />
      <SectionHeader title="Privacidad" />
      <PrivacyCard value={profile.data.visibility} />
      <PrivacyLinkRow />
      <SectionHeader title="Cuenta" />
      <AccountActions isDemo={isDemo} />
    </Screen>
  );
}
