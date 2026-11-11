import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { intensityLabel } from '@/domain/labels';
import type { Intensity } from '@/domain/types';
import { Text, fonts, intensityColor, radius, space, useTheme } from '@/ui';

export interface IntensityTagProps {
  intensity: Intensity;
}

/**
 * Intensity tag: zone colour dot + Spanish label ("Fondo Z2") on a neutral well. The label
 * stays in ink so light zone colours never carry the text contrast.
 */
export function IntensityTag({ intensity }: IntensityTagProps): JSX.Element {
  const { colors } = useTheme();
  const label = intensityLabel(intensity);
  return (
    <View accessible accessibilityLabel={`Intensidad: ${label}`} style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.dot, { backgroundColor: intensityColor[intensity] }]} />
      <Text variant="caption" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface ZoneTagProps {
  intensity: Intensity;
  /** "Z4", "Carrera". */
  zone: string;
}

/** Compact zone chip for step rows and zone tables: zone colour dot + "Z4" in ink. */
export function ZoneTag({ intensity, zone }: ZoneTagProps): JSX.Element {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`Zona ${zone}`} style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.dot, { backgroundColor: intensityColor[intensity] }]} />
      <Text variant="caption" style={[styles.label, styles.tabular]} numberOfLines={1}>
        {zone}
      </Text>
    </View>
  );
}

const DOT = 8;

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16 },
  tabular: { fontVariant: ['tabular-nums'] },
});
