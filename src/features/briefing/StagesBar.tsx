import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { Text, radius, space, useTheme, type Theme } from '@/ui';

import { spokenDuration, type SleepStage, type SleepStageKey } from './briefingModel';

const BAR_HEIGHT = 14;

/** Stage palette from theme tokens: deep = info, REM = violet, light = soft info, awake = warning. */
export function stageColor(key: SleepStageKey, theme: Theme): string {
  const { colors } = theme;
  if (key === 'deep') return colors.info;
  if (key === 'rem') return theme.sport('bike').base;
  if (key === 'light') return `${colors.info}66`;
  return colors.warning;
}

/** Proportional bar of the night's stages + legend with minutes and share. */
export function StagesBar({ stages }: { stages: SleepStage[] }) {
  const theme = useTheme();
  if (stages.length === 0) return null;
  const summary = stages.map((s) => `${s.label}: ${spokenDuration(s.minutes)}, ${s.pct} por ciento`).join('; ');
  return (
    <View style={styles.root}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Fases del sueño. ${summary}`}
        style={[styles.bar, { backgroundColor: theme.colors.surfaceAlt }]}>
        {stages.map((s) => (
          <View key={s.key} style={{ flexGrow: s.minutes, flexBasis: 0, backgroundColor: stageColor(s.key, theme) }} />
        ))}
      </View>
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {stages.map((s) => (
          <View key={s.key} style={styles.item}>
            <View style={[styles.swatch, { backgroundColor: stageColor(s.key, theme) }]} />
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                {s.label}
              </Text>
              <Text variant="bodyStrong">{`${formatDuration(s.minutes)} · ${s.pct} %`}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  bar: { flexDirection: 'row', height: BAR_HEIGHT, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm, columnGap: space.lg },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexBasis: '44%', flexGrow: 1 },
  swatch: { width: 10, height: 10, borderRadius: 3, marginTop: 4 },
  flex: { flex: 1 },
});
