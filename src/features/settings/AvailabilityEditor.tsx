import { StyleSheet, View } from 'react-native';

import { weekdayLabel } from '@/domain/labels';
import type { Availability, Weekday } from '@/domain/types';
import { Chip, Stepper, Text, space, useTheme } from '@/ui';

import {
  MAX_WEEKLY_HOURS,
  MIN_WEEKLY_HOURS,
  WEEKDAYS,
  WEEKLY_HOURS_STEP,
  customWindows,
  formatHours,
  removeWindow,
  setRestDay,
  toggleWeekday,
  windowsCapacityMinutes,
} from './availabilityModel';
import { CustomWindowsList } from './CustomWindowsList';
import { DayPicker } from './DayPicker';
import { WindowsGrid } from './WindowsGrid';

export interface AvailabilityEditorProps {
  value: Availability;
  onChange: (next: Availability) => void;
}

/**
 * Weekly availability template shared by onboarding (step 3) and
 * settings/availability: hours budget, rest/long/pool days and time windows.
 */
export function AvailabilityEditor({ value, onChange }: AvailabilityEditorProps) {
  const { sport } = useTheme();
  const capacityH = windowsCapacityMinutes(value.windows) / 60;
  const custom = customWindows(value.windows);

  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <Stepper
          label="Horas por semana"
          value={value.weeklyHoursTarget}
          step={WEEKLY_HOURS_STEP}
          min={MIN_WEEKLY_HOURS}
          max={MAX_WEEKLY_HOURS}
          format={formatHours}
          onChange={(weeklyHoursTarget) => onChange({ ...value, weeklyHoursTarget })}
        />
        <Text variant="caption" color="textMuted">
          Es tu presupuesto en una semana normal. En semanas de descarga y de afinado el plan lo baja solo.
        </Text>
      </View>

      <RestDayPicker value={value.restDay} onChange={(day) => onChange(setRestDay(value, day))} />

      <DayPicker
        label="Días de sesión larga"
        hint="Donde caben la tirada y la salida en bici largas (normalmente el finde)."
        selected={value.longSessionDays}
        disabledDays={value.restDay === null ? [] : [value.restDay]}
        onToggle={(day) => onChange({ ...value, longSessionDays: toggleWeekday(value.longSessionDays, day) })}
      />

      <DayPicker
        label="Días con piscina"
        hint={value.poolDays.length === 0 ? 'Sin marcar = cualquier día.' : 'Solo pondremos natación estos días.'}
        selected={value.poolDays}
        color={sport('swim').base}
        onToggle={(day) => onChange({ ...value, poolDays: toggleWeekday(value.poolDays, day) })}
      />

      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Franjas para entrenar
        </Text>
        <WindowsGrid
          windows={value.windows}
          restDay={value.restDay}
          onChange={(windows) => onChange({ ...value, windows })}
        />
        <Text variant="caption" color="textMuted">
          {value.windows.length === 0
            ? 'Sin franjas, el plan propone horas a partir de tus huecos libres del calendario.'
            : `Tus franjas suman ${formatHours(capacityH)} a la semana.`}
        </Text>
        <CustomWindowsList
          windows={custom}
          onRemove={(w) => onChange({ ...value, windows: removeWindow(value.windows, w) })}
        />
      </View>
    </View>
  );
}

function RestDayPicker({ value, onChange }: { value: Weekday | null; onChange: (day: Weekday | null) => void }) {
  return (
    <View style={styles.block}>
      <Text variant="overline" color="textMuted">
        Día de descanso
      </Text>
      <View style={styles.chips}>
        {WEEKDAYS.map((day) => (
          <Chip key={day} label={weekdayLabel(day)} selected={value === day} onPress={() => onChange(day)} />
        ))}
        <Chip label="Ninguno fijo" selected={value === null} onPress={() => onChange(null)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
