import { StyleSheet, View } from 'react-native';

import type { LegPlan } from '@/domain/racePlan';
import { SportBadge, Text, fonts, space } from '@/ui';

export interface RacePlanLegProps {
  sport: 'swim' | 'bike' | 'run';
  title: string;
  leg: LegPlan;
  /** Extra guidance under the targets (run: heart rate). */
  note?: string | null;
}

/** One leg of the race plan: sport, distance, main target, sensations and its parts in order. */
export function RacePlanLeg({ sport, title, leg, note }: RacePlanLegProps) {
  const [main, ...rest] = leg.targets;
  return (
    <View style={styles.leg} testID={`race-plan-${sport}`}>
      <View style={styles.header}>
        <SportBadge sport={sport} size={32} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" color="textMuted">
            {leg.distance}
          </Text>
        </View>
      </View>
      {main ? (
        <View style={styles.targets}>
          <Text variant="heading" style={styles.numbers}>
            {main}
          </Text>
          {rest.length > 0 ? (
            <Text variant="caption" color="textMuted" style={styles.numbers}>
              {rest.join(' · ')}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="callout" color="textMuted">
        {leg.feel}
      </Text>
      {note ? <Text variant="callout">{note}</Text> : null}
      <View style={styles.steps}>
        {leg.steps.map((step) => (
          <View key={step.label} style={styles.step} accessible>
            <Text variant="callout">
              <Text variant="callout" style={styles.label}>
                {step.label}
              </Text>
              {step.target ? <Text variant="callout" style={styles.numbers}>{` · ${step.target}`}</Text> : null}
            </Text>
            <Text variant="caption" color="textMuted">
              {step.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  leg: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  targets: { gap: 2 },
  numbers: { fontVariant: ['tabular-nums'] },
  steps: { gap: space.sm, paddingTop: space.xs },
  step: { gap: 2 },
  label: { fontFamily: fonts.bodySemibold },
});
