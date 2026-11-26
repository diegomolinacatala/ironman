import { StyleSheet, View } from 'react-native';

import { formatFinishRange, formatLegRange, type PredictionOutcome, type RacePrediction } from '@/domain/racePrediction';
import { Text, space } from '@/ui';

/** "Natación 35–38' · T1 3–6' · Bici 2:38–2:50 · T2 2–4' · Carrera 1:43–1:52" (triathlons only). */
export function legsLine(p: RacePrediction): string | null {
  if (!p.bike && !p.swim) return null;
  const legs: [string, RacePrediction['swim']][] = [
    ['Natación', p.swim],
    ['T1', p.t1],
    ['Bici', p.bike],
    ['T2', p.t2],
    ['Carrera', p.run],
  ];
  return legs.flatMap(([label, r]) => (r ? [`${label} ${formatLegRange(r)}`] : [])).join(' · ');
}

/** «Previsión: 5:01–5:29», the legs and what it assumes; without thresholds, what to add. */
export function RacePredictionBlock({ outcome }: { outcome: PredictionOutcome }) {
  if (!outcome.ok) {
    return (
      <View style={styles.block} testID="race-prediction">
        <Text variant="bodyStrong">Previsión</Text>
        <Text variant="caption" color="textMuted">
          {outcome.hint}
        </Text>
      </View>
    );
  }
  const p = outcome.prediction;
  const finish = formatFinishRange(p.total);
  const legs = legsLine(p);
  return (
    <View style={styles.block} testID="race-prediction" accessible accessibilityLabel={`Previsión: ${finish}. ${legs ?? ''} ${p.note}`}>
      <Text variant="heading" style={styles.numbers}>{`Previsión: ${finish}`}</Text>
      {legs ? (
        <Text variant="caption" style={styles.numbers}>
          {legs}
        </Text>
      ) : null}
      <Text variant="caption" color="textMuted">
        {p.note}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.xs },
  numbers: { fontVariant: ['tabular-nums'] },
});
