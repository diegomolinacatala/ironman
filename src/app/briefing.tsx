import { Stack, useLocalSearchParams } from 'expo-router';

import { todayISO } from '@/domain/dates';
import { BriefingDetail } from '@/features/briefing/BriefingDetail';
import { ModalCancel } from '@/features/workouts/ModalClose';

/**
 * /briefing — "Informe de hoy" (modal). `?play=1` (widget, morning notification) prepares the
 * briefing if needed and reads it aloud. Reading stops when the screen closes.
 */
export default function BriefingScreen() {
  const params = useLocalSearchParams<{ play?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
      <BriefingDetail date={todayISO()} autoplay={params.play === '1'} />
    </>
  );
}
