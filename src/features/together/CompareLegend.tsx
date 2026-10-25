import { StyleSheet, View } from 'react-native';

import { Text, space, useTheme } from '@/ui';

import { Hatch } from './Hatch';
import { slotEdge, slotTint } from './palette';

/** Key for the compare tracks: session · ocupado · hueco común. */
export function CompareLegend() {
  const theme = useTheme();
  const { colors } = theme;
  const run = theme.sport('run');
  return (
    <View style={styles.row} accessibilityLabel="Leyenda: entreno en color de deporte, ocupado rayado, hueco común en lima">
      <View style={styles.item}>
        <View style={[styles.swatch, { backgroundColor: run.tint, borderColor: run.base }]} />
        <Text variant="caption" color="textMuted">
          Entreno
        </Text>
      </View>
      <View style={styles.item}>
        <View style={[styles.swatch, styles.clip, { borderColor: colors.border }]}>
          <Hatch color={colors.borderStrong} background={colors.surface} spacing={4} strokeWidth={1} />
        </View>
        <Text variant="caption" color="textMuted">
          Ocupado
        </Text>
      </View>
      <View style={styles.item}>
        <View style={[styles.swatch, { backgroundColor: slotTint(colors), borderColor: slotEdge(colors) }]} />
        <Text variant="caption" color="textMuted">
          Hueco común
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 18, height: 12, borderRadius: 3, borderWidth: 1 },
  clip: { overflow: 'hidden' },
});
