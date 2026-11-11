import { StyleSheet, View } from 'react-native';

import { sessionFeel, stepLines, type StepLine } from '@/domain/prescription';
import type { RaceDistance, Thresholds, Workout } from '@/domain/types';
import { Card, Divider, Icon, SectionHeader, Text, iconSize, intensityColor, space, useTheme } from '@/ui';

import { a11ySentences } from '../format';
import { ZoneTag } from '../IntensityTag';
import { StepsBar } from '../StepsBar';

export interface StructureProps {
  workout: Workout;
  thresholds: Thresholds | null;
  raceDistance: RaceDistance | null;
}

const RAIL = 4;

function stepA11y(line: StepLine): string {
  const head = `${line.amount} ${line.label}`.trim();
  return a11ySentences([head, line.zone ? `Zona ${line.zone}` : '', line.targets.join(', '), line.cue, line.note]);
}

function StepRow({ line }: { line: StepLine }) {
  const targets = line.targets.join(' · ');
  return (
    <View accessible accessibilityLabel={stepA11y(line)} style={styles.row}>
      <View style={[styles.rail, { backgroundColor: intensityColor[line.intensity] }]} />
      <View style={styles.body}>
        <View style={styles.head}>
          {line.amount ? (
            <Text variant="bodyStrong" style={styles.tabular}>
              {line.amount}
            </Text>
          ) : null}
          <Text variant="callout" style={styles.flex}>
            {line.label}
          </Text>
          {line.zone ? <ZoneTag intensity={line.intensity} zone={line.zone} /> : null}
        </View>
        {targets ? (
          <Text variant="callout" style={styles.tabular}>
            {targets}
          </Text>
        ) : null}
        {line.cue ? (
          <Text variant="caption" color="textMuted">
            {line.cue}
          </Text>
        ) : null}
        {line.note ? (
          <Text variant="caption" color="textMuted">
            {line.note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "Estructura": the proportional bar, then one row per step with zone, targets and how it should feel. */
export function StructureSection({ workout, thresholds, raceDistance }: StructureProps) {
  if (workout.steps.length === 0) return null;
  const lines = stepLines(workout, thresholds, { raceDistance });
  return (
    <View style={styles.section}>
      <SectionHeader title="Estructura" />
      <StepsBar steps={workout.steps} intensity={workout.intensity} sport={workout.sport} showLegend={false} />
      <Card padding="md" style={styles.list}>
        {lines.map((line, index) => (
          <View key={`${index}-${line.kind}`} style={styles.list}>
            {index > 0 ? <Divider /> : null}
            <StepRow line={line} />
          </View>
        ))}
      </Card>
    </View>
  );
}

/** Sessions without steps: how the whole session should feel (talk test, breathing, technique). */
export function FeelNote({ workout, thresholds, raceDistance }: StructureProps) {
  const { colors } = useTheme();
  if (workout.steps.length > 0 || workout.sport === 'rest') return null;
  const feel = sessionFeel(workout, thresholds, { raceDistance });
  return (
    <Card variant="tinted" tint={colors.surfaceAlt} padding="md">
      <View accessible accessibilityLabel={`Cómo debe sentirse: ${feel}`} style={styles.feel}>
        <Icon name="waveform" size={iconSize.sm + 2} color={colors.textMuted} />
        <View style={styles.body}>
          <Text variant="caption" color="textMuted">
            Cómo debe sentirse
          </Text>
          <Text variant="callout">{feel}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  list: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  rail: { width: RAIL, borderRadius: RAIL / 2, alignSelf: 'stretch' },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  feel: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
});
