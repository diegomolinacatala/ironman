import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, StyleSheet, View } from 'react-native';

import { formatDayLong, parseISODate, toISODate } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Text, TextField, radius, space, useTheme } from '@/ui';

export interface RaceDateFieldProps {
  value: ISODate;
  onChange: (date: ISODate) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** iOS: native compact date picker. Web/other: typed YYYY-MM-DD. */
export function RaceDateField({ value, onChange }: RaceDateFieldProps) {
  const { colors, isDark } = useTheme();
  const valid = DATE_RE.test(value);

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.field}>
        <Text variant="overline" color="textMuted">
          Fecha
        </Text>
        <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="body" style={styles.flex} numberOfLines={1}>
            {valid ? formatDayLong(value) : 'Elige fecha'}
          </Text>
          <DateTimePicker
            value={valid ? parseISODate(value) : new Date()}
            mode="date"
            display="compact"
            locale="es-ES"
            themeVariant={isDark ? 'dark' : 'light'}
            accentColor={colors.text}
            onValueChange={(_event, date) => onChange(toISODate(date))}
            accessibilityLabel="Fecha de la carrera"
          />
        </View>
      </View>
    );
  }

  return (
    <TextField
      label="Fecha"
      value={value}
      onChangeText={(text) => onChange(text.trim())}
      placeholder="AAAA-MM-DD"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={10}
      hint={valid ? formatDayLong(value) : 'Formato AAAA-MM-DD, por ejemplo 2027-05-16'}
      accessibilityLabel="Fecha de la carrera"
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  flex: { flex: 1 },
});
