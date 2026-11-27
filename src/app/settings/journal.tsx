import { JournalHabitsPicker } from '@/features/settings/JournalHabitsPicker';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { Screen } from '@/ui';

export default function JournalHabitsScreen() {
  return (
    <ProfileGate>
      {(profile) => (
        <Screen inSheet>
          <JournalHabitsPicker profile={profile} />
        </Screen>
      )}
    </ProfileGate>
  );
}
