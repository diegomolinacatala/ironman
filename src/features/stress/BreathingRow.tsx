import { LinkRows } from '../account/SettingsGroup';
import { BREATHING_PATH } from './breathingModel';

/** Tú › Tu coach → Respiración guiada (also opened by the bedtime reminder and the stress card on Hoy). */
export function BreathingRow() {
  return (
    <LinkRows
      items={[{ icon: 'waveform', title: 'Respiración guiada', subtitle: '3 minutos para bajar revoluciones', href: BREATHING_PATH, brand: true }]}
    />
  );
}
