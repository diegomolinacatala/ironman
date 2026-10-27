import { PrivacyCard } from '@/features/account/PrivacyCard';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { ProfileForm } from '@/features/settings/ProfileForm';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { Screen, SectionHeader } from '@/ui';

export default function ProfileSettingsScreen() {
  return (
    <KeyboardAvoider>
      <ProfileGate>
        {(profile) => (
          <Screen inSheet>
            <ProfileForm profile={profile} />
            <SectionHeader title="Qué ven tus amigos" />
            <PrivacyCard value={profile.visibility} />
          </Screen>
        )}
      </ProfileGate>
    </KeyboardAvoider>
  );
}
