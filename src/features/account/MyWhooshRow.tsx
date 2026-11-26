import { setMyWhooshEnabled, useMyWhooshEnabled } from '@/features/workouts/myWhooshSetting';

import { SwitchRow } from '../settings/SwitchRow';

/** Tú › Entrenamiento: «Entreno en rodillo con MyWhoosh» (device setting, off by default). */
export function MyWhooshRow() {
  const enabled = useMyWhooshEnabled();
  return (
    <SwitchRow
      icon="bike"
      title="Entreno en rodillo con MyWhoosh"
      subtitle="En cada sesión de bici te diremos el entrenamiento gratuito de MyWhoosh más parecido"
      value={enabled}
      onChange={(value) => void setMyWhooshEnabled(value)}
    />
  );
}
