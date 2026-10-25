import { NotificationPrefsForm } from '@/features/settings/NotificationPrefsForm';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { Screen } from '@/ui';

export default function NotificationSettingsScreen() {
  return (
    <ProfileGate>
      {(profile) => (
        <Screen inSheet>
          <NotificationPrefsForm profile={profile} />
        </Screen>
      )}
    </ProfileGate>
  );
}
