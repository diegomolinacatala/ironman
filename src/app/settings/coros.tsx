import { CorosGuide } from '@/features/settings/CorosGuide';
import { Screen } from '@/ui';

/** "Conectar COROS": the step-by-step guide (from Tú › Conexiones, the COROS card and the onboarding). */
export default function CorosGuideScreen() {
  return (
    <Screen inSheet>
      <CorosGuide />
    </Screen>
  );
}
