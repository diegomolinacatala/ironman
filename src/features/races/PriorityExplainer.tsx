import { StyleSheet, View } from 'react-native';

import { Text, radius, space, useTheme } from '@/ui';

import { PriorityBadge } from './PriorityBadge';
import { PRIORITIES, PRIORITY_INFO } from './raceModel';

/** Short explanation of A/B/C priorities. */
export function PriorityExplainer() {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="overline" color="textMuted">
        Prioridades
      </Text>
      {PRIORITIES.map((p) => (
        <View key={p} style={styles.row}>
          <PriorityBadge priority={p} size={24} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{PRIORITY_INFO[p].title}</Text>
            <Text variant="caption" color="textMuted">
              {PRIORITY_INFO[p].help}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1, gap: 2 },
});
