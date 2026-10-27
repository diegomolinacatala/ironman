import { StyleSheet, View } from 'react-native';

import { Text, space } from '@/ui';

import { BellButton } from './BellButton';

export interface TodayHeaderProps {
  greeting: string;
  dateLine: string;
  unread: number;
}

/** "Buenos días, Diego" + date line, with the notifications bell. */
export function TodayHeader({ greeting, dateLine, unread }: TodayHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="title" accessibilityRole="header">
          {greeting}
        </Text>
        <Text variant="callout" color="textMuted">
          {dateLine}
        </Text>
      </View>
      <BellButton unread={unread} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  text: { flex: 1, gap: 2 },
});
