import { StyleSheet, View } from 'react-native';

import { formatDayLabel } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Text, space } from '@/ui';

import { slotsByDay } from './compareModel';
import { SlotPill } from './SlotPill';
import type { Slot } from './types';

export interface CommonSlotsListProps {
  slots: readonly Slot[];
  today: ISODate;
  friendName: string;
  onPropose: (slot: Slot) => void;
  /** Max days listed (rest summarised). */
  maxDays?: number;
}

/** "Huecos comunes": one row per day with lime bands you can tap to propose. */
export function CommonSlotsList({ slots, today, friendName, onPropose, maxDays = 7 }: CommonSlotsListProps) {
  const days = slotsByDay(slots);
  if (days.length === 0) {
    return (
      <Text variant="callout" color="textMuted">
        Esta semana no coincidís en ningún hueco libre de 45&apos; o más. Mira la semana completa para buscar
        alternativas con {friendName}.
      </Text>
    );
  }
  const shown = days.slice(0, maxDays);
  return (
    <View style={styles.list}>
      {shown.map((day) => (
        <View key={day.date} style={styles.day}>
          <Text variant="overline" color={day.date === today ? 'accentInk' : 'textMuted'} style={styles.dayLabel}>
            {formatDayLabel(day.date, today)}
          </Text>
          <View style={styles.pills}>
            {day.slots.map((slot) => (
              <SlotPill key={`${slot.date}-${slot.start}`} slot={slot} onPress={() => onPropose(slot)} />
            ))}
          </View>
        </View>
      ))}
      {days.length > shown.length ? (
        <Text variant="caption" color="textMuted">
          {days.length - shown.length === 1 ? 'Y 1 día más con huecos.' : `Y ${days.length - shown.length} días más con huecos.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  day: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  dayLabel: { width: 72, paddingTop: 15 },
  pills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
