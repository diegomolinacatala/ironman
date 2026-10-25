import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { intensityLabel } from '@/domain/labels';
import type { Intensity } from '@/domain/types';
import { Text, intensityColor, radius, useTheme } from '@/ui';

export interface IntensityTagProps {
  intensity: Intensity;
}

/**
 * Intensity pill: zone colour swatch + Spanish label ("Fondo Z2"). The label
 * stays in ink colour so light zone colours keep enough contrast.
 */
export function IntensityTag({ intensity }: IntensityTagProps): JSX.Element {
  const { colors } = useTheme();
  const label = intensityLabel(intensity);
  return (
    <View
      accessible
      accessibilityLabel={`Intensidad: ${label}`}
      style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.swatch, { backgroundColor: intensityColor[intensity] }]} />
      <Text variant="overline" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  label: { fontSize: 11 },
});
