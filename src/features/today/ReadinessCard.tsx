import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Readiness } from '@/domain/readiness';
import { Button, Card, Text, space, useTheme } from '@/ui';

import { ReadinessRing, readinessColor, readinessLabel } from '@/features/checkin/ReadinessRing';

export interface ReadinessCardProps {
  readiness: Readiness;
  hasCheckin: boolean;
}

/** Daily readiness: ring + level + top factors + recommendation, check-in CTA. */
export function ReadinessCard({ readiness, hasCheckin }: ReadinessCardProps) {
  const { colors } = useTheme();
  const factors = readiness.factors.slice(0, 2);
  return (
    <Card
      padding="lg"
      // Only pressable when there is no inner CTA: nested pressables are invalid (and break on web).
      onPress={hasCheckin ? () => router.push('/checkin') : undefined}
      accessibilityLabel={`Disposición: ${readinessLabel(readiness.level)}. ${readiness.recommendation}`}>
      <View style={styles.row}>
        <ReadinessRing readiness={readiness} />
        <View style={styles.body}>
          <Text variant="overline" color="textMuted">
            Disposición
          </Text>
          <Text variant="heading" style={{ color: readiness.level === 'unknown' ? colors.text : readinessColor(readiness.level, colors) }}>
            {readinessLabel(readiness.level)}
          </Text>
          {factors.map((f) => (
            <Text key={f} variant="caption" color="textMuted">
              {`· ${f}`}
            </Text>
          ))}
        </View>
      </View>
      <Text variant="callout" style={styles.recommendation}>
        {readiness.recommendation}
      </Text>
      {hasCheckin ? null : (
        <Button
          label="Hacer check-in (30 s)"
          icon="heart"
          variant="inverse"
          size="sm"
          onPress={() => router.push('/checkin')}
          style={styles.cta}
          accessibilityHint="Cuéntanos cómo has dormido y cómo estás"
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  body: { flex: 1, gap: 2 },
  recommendation: { marginTop: space.md },
  cta: { alignSelf: 'flex-start', marginTop: space.md },
});
