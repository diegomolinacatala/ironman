import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, space } from '@/ui';

import { BellButton } from './BellButton';

export interface TodayHeaderProps {
  greeting: string;
  dateLine: string;
  unread: number;
  /** "Faltan 168 días para …" (tappable: opens the races). */
  countdown?: string | null;
}

/** "Buenos días, Diego" + date line, with the notifications bell. */
export function TodayHeader({ greeting, dateLine, unread, countdown }: TodayHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="title" accessibilityRole="header">
          {greeting}
        </Text>
        <Text variant="callout" color="textMuted">
          {dateLine}
        </Text>
        {countdown ? (
          <Pressable accessibilityRole="link" onPress={() => router.push('/races')} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <Text variant="callout" color="accentInk">
              {countdown}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <BellButton unread={unread} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
});
