import { StyleSheet, View } from 'react-native';

import { readinessLabel as domainReadinessLabel } from '@/domain/labels';
import type { Readiness } from '@/domain/readiness';
import { ProgressRing, Text, useTheme, type Theme } from '@/ui';

type Level = Readiness['level'];

const LEVEL_SHORT: Record<Level, string> = {
  green: 'Verde',
  amber: 'Ámbar',
  red: 'Rojo',
  unknown: 'Sin datos',
};

/** Spanish label of a readiness level (domain wording). */
export function readinessLabel(level: Level): string {
  return domainReadinessLabel(level);
}

export function readinessShort(level: Level): string {
  return LEVEL_SHORT[level];
}

export function readinessColor(level: Level, colors: Theme['colors']): string {
  if (level === 'green') return colors.success;
  if (level === 'amber') return colors.warning;
  if (level === 'red') return colors.danger;
  return colors.textFaint;
}

/** Score ring (0–100) coloured by readiness level, number in the middle. */
export function ReadinessRing({ readiness, size = 76 }: { readiness: Readiness; size?: number }) {
  const { colors } = useTheme();
  const color = readinessColor(readiness.level, colors);
  const score = readiness.score;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Disposición ${score != null ? `${Math.round(score)} de 100` : 'sin datos'}, ${LEVEL_SHORT[readiness.level]}`}>
      <ProgressRing value={score != null ? score / 100 : 0} size={size} stroke={Math.max(6, size / 10)} color={color}>
        <View style={styles.center}>
          <Text variant={size >= 72 ? 'metric' : 'metricSmall'}>{score != null ? String(Math.round(score)) : '–'}</Text>
        </View>
      </ProgressRing>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
