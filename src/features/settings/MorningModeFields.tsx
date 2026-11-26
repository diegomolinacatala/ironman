import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { NotificationPrefs } from '@/domain/types';
import { Button, Chip, Segmented, Stepper, Text, space } from '@/ui';

import { FormLabel } from './FormLabel';
import { minutesToClock } from './format';
import { WAKE_DELAYS, WAKE_MODE_HELP, delayLabel, type WakeWindowView } from './wakeModel';

type Mode = 'fixed' | 'wake';

const MODES: { value: Mode; label: string }[] = [
  { value: 'fixed', label: 'A una hora fija' },
  { value: 'wake', label: 'Al despertar' },
];

const STEP_MIN = 15;
/** The window's ends never cross: at least 30 min between them. */
const MIN_SPAN_MIN = 30;
const EARLIEST_MIN = 4 * 60;
const LATEST_MIN = 13 * 60;

export interface MorningModeFieldsProps {
  prefs: Pick<NotificationPrefs, 'morningMode' | 'wakeDelayMin' | 'wakeWindow'>;
  onChange: (patch: Partial<Pick<NotificationPrefs, 'morningMode' | 'wakeDelayMin' | 'wakeWindow'>>) => void;
  /** The fixed-time control (each screen keeps its own picker). */
  timeControl: ReactNode;
  /** Window + fallback and the "your own window" editor; null where there is no room (Tú). */
  windowView?: WakeWindowView | null;
}

function WindowEditor({ view, onChange }: { view: WakeWindowView; onChange: MorningModeFieldsProps['onChange'] }) {
  const from = view.window.from;
  const to = view.window.to;
  const set = (next: { from: number; to: number }) => onChange({ wakeWindow: { from: minutesToClock(next.from), to: minutesToClock(next.to) } });
  if (view.source !== 'override') {
    return <Button label="Elegir mi franja" variant="ghost" size="sm" onPress={() => set({ from, to })} />;
  }
  return (
    <View style={styles.editor}>
      <View style={styles.steppers}>
        <View style={styles.flex}>
          <Stepper
            label="Desde"
            value={from}
            step={STEP_MIN}
            min={EARLIEST_MIN}
            max={to - MIN_SPAN_MIN}
            format={minutesToClock}
            onChange={(value) => set({ from: value, to })}
          />
        </View>
        <View style={styles.flex}>
          <Stepper
            label="Hasta"
            value={to}
            step={STEP_MIN}
            min={from + MIN_SPAN_MIN}
            max={LATEST_MIN}
            format={minutesToClock}
            onChange={(value) => set({ from, to: value })}
          />
        </View>
      </View>
      <Button label="Usar la de mi reloj" variant="ghost" size="sm" onPress={() => onChange({ wakeWindow: null })} />
    </View>
  );
}

/**
 * «Aviso del informe»: a fixed time (default) or when you wake up, with the delay
 * (5, 10, 15 or 30 min) and, where there is room, the usual wake-up window and the fallback.
 */
export function MorningModeFields({ prefs, onChange, timeControl, windowView }: MorningModeFieldsProps) {
  const mode: Mode = prefs.morningMode === 'wake' ? 'wake' : 'fixed';
  const delay = typeof prefs.wakeDelayMin === 'number' ? prefs.wakeDelayMin : 15;
  return (
    <View style={styles.wrap}>
      <View style={styles.group}>
        <FormLabel>Aviso del informe</FormLabel>
        <Segmented<Mode> accessibilityLabel="Aviso del informe" options={MODES} value={mode} onChange={(next) => onChange({ morningMode: next })} />
      </View>
      {mode === 'fixed' ? (
        timeControl
      ) : (
        <View style={styles.group}>
          <Text variant="caption" color="textMuted">
            {WAKE_MODE_HELP}
          </Text>
          <FormLabel>Después de despertar</FormLabel>
          <View style={styles.chips}>
            {WAKE_DELAYS.map((min) => (
              <Chip key={min} label={delayLabel(min)} selected={delay === min} onPress={() => onChange({ wakeDelayMin: min })} />
            ))}
          </View>
          {windowView ? (
            <View style={styles.group} testID="wake-window">
              <Text variant="caption">{windowView.windowText}</Text>
              <Text variant="caption" color="textMuted">
                {windowView.fallbackText}
              </Text>
              <WindowEditor view={windowView} onChange={onChange} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  editor: { gap: space.sm },
  steppers: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});
