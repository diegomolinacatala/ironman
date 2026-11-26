import { Stack } from 'expo-router';

import { BreathingSession } from '@/features/stress/BreathingSession';
import { ModalCancel, closeModal } from '@/features/workouts/ModalClose';
import { Screen } from '@/ui';

/**
 * /breathing — "Respira" (modal): three minutes of slow breathing. Opened from the bedtime
 * reminder, the stress card on Hoy and Tú › Tu coach.
 */
export default function BreathingScreen() {
  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
      <Screen inSheet accessibilityLabel="Respiración guiada">
        <BreathingSession onClose={closeModal} />
      </Screen>
    </>
  );
}
