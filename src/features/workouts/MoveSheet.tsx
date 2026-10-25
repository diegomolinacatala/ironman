import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { addDays, formatDayLabel, formatDayShort } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Button, Chip, Text, space } from '@/ui';

import { DateField } from './DateField';
import { SheetModal } from './SheetModal';

const DAYS_AHEAD = 14;

export interface MoveSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (date: ISODate) => void;
  /** Current date of the workout (excluded from the options). */
  fromDate: ISODate;
  today: ISODate;
  busy?: boolean;
}

/** Day options for moving a workout: today … +13 days. */
export function moveOptions(fromDate: ISODate, today: ISODate): ISODate[] {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)).filter((d) => d !== fromDate);
}

/** Bottom sheet to move a session to tomorrow, a day of the next two weeks or any date. */
export function MoveSheet({ visible, onClose, onSelect, fromDate, today, busy = false }: MoveSheetProps) {
  const tomorrow = addDays(today, 1);
  // Tomorrow already has its own primary button.
  const options = moveOptions(fromDate, today).filter((d) => d !== tomorrow);
  const [custom, setCustom] = useState<ISODate>(addDays(today, DAYS_AHEAD));
  return (
    <SheetModal visible={visible} onClose={onClose} overline={`Ahora: ${formatDayLabel(fromDate, today)}`} title="Mover entreno">
      {tomorrow !== fromDate ? (
        <Button
          label={`Mañana · ${formatDayShort(tomorrow)}`}
          icon="move"
          onPress={() => onSelect(tomorrow)}
          loading={busy}
          fullWidth
          size="lg"
        />
      ) : null}
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Elegir día
        </Text>
        <View style={styles.grid}>
          {options.map((date) => (
            <Chip key={date} label={formatDayLabel(date, today)} onPress={() => onSelect(date)} disabled={busy} />
          ))}
        </View>
      </View>
      <View style={styles.block}>
        <DateField label="Otra fecha" value={custom} onChange={setCustom} />
        <Button
          label={`Mover al ${formatDayShort(custom)}`}
          variant="secondary"
          onPress={() => onSelect(custom)}
          disabled={busy || custom === fromDate}
          fullWidth
        />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
