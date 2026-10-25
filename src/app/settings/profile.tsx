import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { ProfileForm } from '@/features/settings/ProfileForm';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { Screen } from '@/ui';

export default function ProfileSettingsScreen() {
  return (
    <KeyboardAvoider>
      <ProfileGate>
        {(profile) => (
          <Screen inSheet>
            <ProfileForm profile={profile} />
          </Screen>
        )}
      </ProfileGate>
    </KeyboardAvoider>
  );
}
