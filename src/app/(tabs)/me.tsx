import { useAuth } from '@/data/context';
import { useIntegrations, useProfile, useRaces, useTokens } from '@/data/queries';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { AccountActions } from '@/features/account/AccountActions';
import { CoachNotesSection } from '@/features/account/CoachNotesSection';
import { ConnectionsSection } from '@/features/account/ConnectionsSection';
import { CoachVoiceRow, PreferencesGroup, PrivacyGroup, TrainingGroup } from '@/features/account/HubSections';
import { MorningSection } from '@/features/account/MorningSection';
import { ProfileHero } from '@/features/account/ProfileHero';
import { GroupDivider, SettingsGroup } from '@/features/account/SettingsGroup';
import { errorMessage } from '@/lib/logger';
import { EmptyState, ErrorNotice, Loading, Screen } from '@/ui';

/**
 * Tú: the settings hub — who you are, then grouped lists (Entrenamiento, Tu coach,
 * Conexiones, Preferencias, Privacidad) and, apart, Cuenta. See docs/DESIGN.md §6.
 */
export default function MeScreen() {
  const { mode } = useAuth();
  const profile = useProfile();
  const races = useRaces();
  const integrations = useIntegrations();
  const tokens = useTokens();
  const isDemo = mode === 'demo';
  const bottomPadding = useTabBottomPadding();
  // Room for the iOS 26 tab bar + coach accessory, so Cuenta and the version line stay reachable.
  const contentStyle = bottomPadding != null ? { paddingBottom: bottomPadding } : undefined;
  const refresh = () => {
    void profile.refetch();
    void races.refetch();
    void integrations.refetch();
    void tokens.refetch();
  };

  if (profile.isLoading) {
    return (
      <Screen title="Tú" contentStyle={contentStyle}>
        <Loading label="Cargando tu perfil" />
      </Screen>
    );
  }
  if (!profile.data) {
    return (
      <Screen title="Tú" contentStyle={contentStyle}>
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
    <Screen title="Tú" onRefresh={refresh} refreshing={profile.isRefetching} contentStyle={contentStyle}>
      <ProfileHero profile={me} isDemo={isDemo} />
      <TrainingGroup profile={me} races={races.data} />
      <SettingsGroup title="Tu coach">
        <MorningSection profile={me} />
        <GroupDivider />
        <CoachVoiceRow />
        <GroupDivider />
        <CoachNotesSection notes={me.coachNotes} />
      </SettingsGroup>
      <ConnectionsSection profile={me} />
      <PreferencesGroup />
      <PrivacyGroup />
      <AccountActions isDemo={isDemo} />
    </Screen>
  );
}
