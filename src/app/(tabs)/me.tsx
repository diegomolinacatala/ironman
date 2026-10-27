import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useIntegrations, useProfile, useRaces, useTokens } from '@/data/queries';
import { AccountActions } from '@/features/account/AccountActions';
import { CoachNotesSection } from '@/features/account/CoachNotesSection';
import { ConnectionsSection } from '@/features/account/ConnectionsSection';
import { MorningSection } from '@/features/account/MorningSection';
import { GoalSection, MoreSection } from '@/features/account/MoreSection';
import { ProfileHero } from '@/features/account/ProfileHero';
import { errorMessage } from '@/lib/logger';
import { EmptyState, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

/** Tú: a calm, scannable hub — who you are, your connections, your morning report, what your coach knows. */
export default function MeScreen() {
  const { mode } = useAuth();
  const profile = useProfile();
  const races = useRaces();
  const integrations = useIntegrations();
  const tokens = useTokens();
  const isDemo = mode === 'demo';
  const refresh = () => {
    void profile.refetch();
    void races.refetch();
    void integrations.refetch();
    void tokens.refetch();
  };

  if (profile.isLoading) {
    return (
      <Screen title="Tú">
        <Loading label="Cargando tu perfil" />
      </Screen>
    );
  }
  if (!profile.data) {
    return (
      <Screen title="Tú">
        {profile.isError ? (
          <ErrorNotice message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
        ) : (
          <EmptyState icon="profile" title="Sin perfil" message="Termina el registro para ver tu perfil." />
        )}
        <AccountActions isDemo={isDemo} />
      </Screen>
    );
  }

  const me = profile.data;
  return (
    <Screen title="Tú" onRefresh={refresh} refreshing={profile.isRefetching}>
      <ProfileHero profile={me} races={races.data} isDemo={isDemo} />

      <SectionHeader title="Conexiones" />
      <ConnectionsSection />

      <SectionHeader title="Cada mañana" />
      <MorningSection profile={me} />

      <SectionHeader title="Tu objetivo" />
      <GoalSection profile={me} />

      <SectionHeader title="Lo que tu coach sabe de ti" />
      <CoachNotesSection notes={me.coachNotes} />

      <SectionHeader title="Más" />
      <MoreSection profile={me} />

      <View style={styles.account}>
        <SectionHeader title="Cuenta" />
        <AccountActions isDemo={isDemo} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: { marginTop: space.xl, gap: space.sm },
});
