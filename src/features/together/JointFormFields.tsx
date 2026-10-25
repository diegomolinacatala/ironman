/**
 * Field groups of the quedada form (friends, sport, time, intensity).
 * Presentational: values in, changes out.
 */
import { StyleSheet, View } from 'react-native';

import { intensityLabel, sportLabel } from '@/domain/labels';
import { INTENSITIES, type Friend, type Intensity, type Sport, type UUID } from '@/domain/types';
import { Chip, Text, TextField, space, useTheme } from '@/ui';

import { JOINT_SPORTS, normalizeTime } from './jointForm';

export function FieldLabel({ children }: { children: string }) {
  return (
    <Text variant="overline" color="textMuted" accessibilityRole="header">
      {children}
    </Text>
  );
}

export function FriendChips({
  friends,
  selected,
  onToggle,
}: {
  friends: readonly Friend[];
  selected: readonly UUID[];
  onToggle: (id: UUID) => void;
}) {
  return (
    <View style={styles.wrap}>
      {friends.map((friend) => (
        <Chip
          key={friend.friendshipId}
          label={friend.profile.displayName}
          icon={selected.includes(friend.profile.id) ? 'check' : 'add'}
          selected={selected.includes(friend.profile.id)}
          onPress={() => onToggle(friend.profile.id)}
        />
      ))}
    </View>
  );
}

export function SportChips({ value, onChange }: { value: Sport; onChange: (sport: Sport) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {JOINT_SPORTS.map((sport) => (
        <Chip
          key={sport}
          label={sportLabel(sport)}
          icon={sport}
          color={theme.sport(sport).base}
          selected={value === sport}
          onPress={() => onChange(sport)}
        />
      ))}
    </View>
  );
}

export function IntensityChips({ value, onChange }: { value: Intensity; onChange: (intensity: Intensity) => void }) {
  return (
    <View style={styles.wrap}>
      {INTENSITIES.map((intensity) => (
        <Chip key={intensity} label={intensityLabel(intensity)} selected={value === intensity} onPress={() => onChange(intensity)} />
      ))}
    </View>
  );
}

const QUICK_TIMES = ['07:00', '09:00', '13:30', '18:00', '19:30'] as const;

export function TimeInput({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const parsed = normalizeTime(value);
  return (
    <View style={styles.group}>
      <TextField
        value={value}
        onChangeText={onChange}
        onBlur={() => {
          if (parsed && parsed !== 'invalid') onChange(parsed);
        }}
        placeholder="18:30 (opcional)"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={5}
        accessibilityLabel="Hora de inicio"
        error={parsed === 'invalid' ? 'Usa el formato 18:30' : null}
        hint={parsed === null ? 'Sin hora: quedáis ese día y la concretáis luego.' : undefined}
      />
      <View style={styles.wrap}>
        <Chip label="Sin hora" selected={parsed === null} onPress={() => onChange('')} />
        {QUICK_TIMES.map((time) => (
          <Chip key={time} label={time} selected={parsed === time} onPress={() => onChange(time)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  group: { gap: space.sm },
});
