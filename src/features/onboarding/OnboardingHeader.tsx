import { StyleSheet, View } from 'react-native';

import { Text, space, useTheme } from '@/ui';

import type { OnboardingStep } from './onboardingModel';

export interface OnboardingHeaderProps {
  step: OnboardingStep;
  index: number;
  total: number;
}

/** Race-bib style step counter ("03/07"), segmented progress and the step title. */
export function OnboardingHeader({ step, index, total }: OnboardingHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={styles.progress}
        accessibilityRole="progressbar"
        accessibilityLabel={`Paso ${index + 1} de ${total}`}
        accessibilityValue={{ min: 1, max: total, now: index + 1 }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i < index ? colors.text : i === index ? colors.accent : colors.surfaceAlt },
              i === index && { borderColor: colors.text, borderWidth: 1 },
            ]}
          />
        ))}
      </View>
      <View style={styles.counter}>
        <Text variant="hero" allowFontScaling={false}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        <Text variant="metricSmall" color="textFaint" style={styles.total}>
          /{String(total).padStart(2, '0')}
        </Text>
        {step.optional ? (
          <View style={[styles.optional, { borderColor: colors.borderStrong }]}>
            <Text variant="overline" color="textMuted">
              Opcional
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.titles}>
        <Text variant="overline" color="accentInk">
          {step.overline}
        </Text>
        <Text variant="display" accessibilityRole="header">
          {step.title}
        </Text>
        <Text variant="callout" color="textMuted">
          {step.subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  progress: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3 },
  counter: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  total: { paddingBottom: 6 },
  optional: { marginLeft: 'auto', marginBottom: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 3 },
  titles: { gap: space.xs },
});
