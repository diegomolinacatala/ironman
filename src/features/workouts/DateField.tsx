import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { formatDayLong, parseISODate, toISODate } from '@/domain/dates';
import type { ISODate, ISOTime } from '@/domain/types';
import { Chip, Icon, Text, radius, space, useTheme } from '@/ui';

import { PatternTextField } from './PatternTextField';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIME: ISOTime = '18:00';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timeToDate(time: ISOTime | null): Date {
  const d = new Date();
  const [h, m] = (time ?? '18:00').split(':').map((n) => Number.parseInt(n, 10));
  d.setHours(Number.isFinite(h) ? h : 18, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function dateToTime(d: Date): ISOTime {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface DateFieldProps {
  label: string;
  value: ISODate;
  onChange: (value: ISODate) => void;
}

/** Date input: native compact picker on iOS, dialog on Android, YYYY-MM-DD text on web. */
export function DateField({ label, value, onChange }: DateFieldProps) {
  if (Platform.OS === 'web') return <PatternTextField label={label} value={value} onChange={onChange} pattern={DATE_RE} placeholder="AAAA-MM-DD" />;
  const date = DATE_RE.test(value) ? parseISODate(value) : new Date();
  return (
    <NativeRow label={label} text={DATE_RE.test(value) ? formatDayLong(value) : 'Elegir fecha'}>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={date}
          mode="date"
          display="compact"
          locale="es-ES"
          onValueChange={(_e, d) => onChange(toISODate(d))}
          accessibilityLabel={label}
        />
      ) : (
        <AndroidOpenButton label={label} onPress={() => DateTimePickerAndroid.open({ value: date, mode: 'date', onValueChange: (_e, d) => onChange(toISODate(d)) })} />
      )}
    </NativeRow>
  );
}

export interface TimeFieldProps {
  label: string;
  value: ISOTime | null;
  onChange: (value: ISOTime | null) => void;
  /** Allow clearing the time ("Sin hora"). */
  optional?: boolean;
}

/** Optional time input with a "Sin hora" toggle. */
export function TimeField({ label, value: rawValue, onChange, optional = true }: TimeFieldProps) {
  const value: ISOTime | null = rawValue ?? (optional ? null : DEFAULT_TIME);
  const enabled = value != null;
  const toggle = optional ? (
    <View style={styles.toggleRow}>
      <Chip label="Sin hora" selected={!enabled} onPress={() => onChange(null)} />
      <Chip label="Con hora" selected={enabled} onPress={() => onChange(value ?? DEFAULT_TIME)} icon="clock" />
    </View>
  ) : null;
  if (value == null) {
    return (
      <View style={styles.field}>
        <Text variant="overline" color="textMuted">
          {label}
        </Text>
        {toggle}
      </View>
    );
  }
  return (
    <View style={styles.field}>
      {Platform.OS === 'web' ? (
        <PatternTextField label={label} value={value} onChange={onChange} pattern={TIME_RE} placeholder="HH:MM" />
      ) : (
        <NativeRow label={label} text={value}>
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={timeToDate(value)}
              mode="time"
              display="compact"
              locale="es-ES"
              minuteInterval={5}
              onValueChange={(_e, d) => onChange(dateToTime(d))}
              accessibilityLabel={label}
            />
          ) : (
            <AndroidOpenButton
              label={label}
              onPress={() =>
                DateTimePickerAndroid.open({ value: timeToDate(value), mode: 'time', is24Hour: true, onValueChange: (_e, d) => onChange(dateToTime(d)) })
              }
            />
          )}
        </NativeRow>
      )}
      {toggle}
    </View>
  );
}

function NativeRow({ label, text, children }: { label: string; text: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      <View style={[styles.nativeRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {text}
        </Text>
        {children}
      </View>
    </View>
  );
}

function AndroidOpenButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Cambiar ${label.toLowerCase()}`} onPress={onPress} hitSlop={8} style={styles.androidBtn}>
      <Icon name="edit" size={18} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  flex: { flex: 1 },
  toggleRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  nativeRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingRight: space.sm,
  },
  androidBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
