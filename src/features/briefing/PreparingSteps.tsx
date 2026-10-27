import { StyleSheet, View } from 'react-native';

import { Icon, Text, radius, space, useTheme } from '@/ui';

import { Skeleton } from './Skeleton';

/** Friendly progress while the briefing is written: done ✓ / current / pending steps + skeleton. */
export function PreparingSteps({ steps, step }: { steps: readonly string[]; step: number }) {
  const { colors } = useTheme();
  const current = steps[Math.min(step, steps.length - 1)];
  return (
    <View style={styles.root}>
      <View style={styles.steps} accessible accessibilityLiveRegion="polite" accessibilityLabel={current}>
        {steps.map((text, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <View key={text} style={styles.step}>
              <View style={[styles.dot, { backgroundColor: done ? colors.success : active ? colors.accent : colors.surfaceAlt }]}>
                <Icon name={done ? 'check' : active ? 'waveform' : 'clock'} size={12} color={done ? colors.inverseText : active ? colors.onAccent : colors.textFaint} />
              </View>
              <Text variant={active ? 'bodyStrong' : 'callout'} color={done || active ? 'text' : 'textFaint'}>
                {text}
              </Text>
            </View>
          );
        })}
      </View>
      <Skeleton height={40} width="85%" />
      <Skeleton height={160} radius={radius.lg} />
      <Skeleton height={96} radius={radius.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.lg },
  steps: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
