import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { Button, Text, TextField, radius, space, useTheme } from '@/ui';

import { formatDateShort } from './format';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromISO(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

function isRealDate(text: string): boolean {
  return ISO_DATE_RE.test(text) && toISO(fromISO(text)) === text;
}

export interface DateFieldProps {
  label: string;
  value: ISODate | null;
  onChange: (date: ISODate | null) => void;
  minimumDate?: ISODate;
  error?: string | null;
}

/**
 * Date input: native compact picker on iOS, typed "AAAA-MM-DD" field elsewhere
 * (web demo, Android) since the community picker has no web implementation.
 */
export function DateField({ label, value, onChange, minimumDate, error }: DateFieldProps) {
  if (Platform.OS === 'ios') {
    return <IosDateField label={label} value={value} onChange={onChange} minimumDate={minimumDate} error={error} />;
  }
  return <TextDateField label={label} value={value} onChange={onChange} error={error} />;
}

/** Default suggestion when no date is set yet: 12 weeks from today (a typical build block). */
const DEFAULT_OFFSET_DAYS = 84;

function IosDateField({ label, value, onChange, minimumDate, error }: DateFieldProps) {
  const { colors, isDark } = useTheme();
  const suggest = () => {
    const d = new Date();
    d.setDate(d.getDate() + DEFAULT_OFFSET_DAYS);
    onChange(toISO(d));
  };
  return (
    <View style={styles.field}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      <View style={[styles.iosRow, { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface }]}>
        <Text variant="body" color={value ? 'text' : 'textFaint'}>
          {value ? formatDateShort(value) : 'Sin fecha'}
        </Text>
        {value ? (
          <DateTimePicker
            value={fromISO(value)}
            mode="date"
            display="compact"
            locale="es-ES"
            themeVariant={isDark ? 'dark' : 'light'}
            accentColor={colors.accentInk}
            minimumDate={minimumDate ? fromISO(minimumDate) : undefined}
            onValueChange={(_event, date) => onChange(toISO(date))}
          />
        ) : (
          <Button label="Elegir fecha" variant="secondary" size="sm" icon="week" onPress={suggest} />
        )}
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function TextDateField({ label, value, onChange, error }: Omit<DateFieldProps, 'minimumDate'>) {
  const [text, setText] = useState(value ?? '');
  const localError = text && !isRealDate(text) ? 'Usa el formato AAAA-MM-DD, p. ej. 2027-05-16' : null;
  return (
    <TextField
      label={label}
      value={text}
      placeholder="AAAA-MM-DD"
      keyboardType="numbers-and-punctuation"
      autoCorrect={false}
      maxLength={10}
      error={localError ?? error ?? null}
      hint={value ? formatDateShort(value) : undefined}
      onChangeText={(next) => {
        setText(next);
        onChange(isRealDate(next) ? next : null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  iosRow: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
