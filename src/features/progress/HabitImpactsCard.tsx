import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IMPACT_MIN_ANSWERS, impactSummary, type HabitImpact, type ImpactDirection } from '@/domain/habitImpacts';
import { Button, Card, Divider, Icon, Text, space, useTheme, type IconName, type Theme } from '@/ui';

const ICONS: Record<ImpactDirection, IconName> = { better: 'arrowUp', worse: 'arrowDown', neutral: 'checkCircle' };

function directionColor(direction: ImpactDirection | null, colors: Theme['colors']): string {
  if (direction === 'better') return colors.success;
  if (direction === 'worse') return colors.danger;
  return colors.textMuted;
}

function ImpactRow({ impact }: { impact: HabitImpact }) {
  const { colors } = useTheme();
  const summary = impactSummary(impact);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${impact.label}: ${summary}`}>
      <Icon name={impact.direction ? ICONS[impact.direction] : 'clock'} size={18} color={directionColor(impact.direction, colors)} />
      <View style={styles.text}>
        <Text variant="bodyStrong">{impact.label}</Text>
        <Text variant="caption" color="textMuted">
          {summary}
        </Text>
      </View>
    </View>
  );
}

export interface HabitImpactsCardProps {
  impacts: HabitImpact[];
  noWatchData: boolean;
}

/**
 * "Qué te afecta" (Whoop Journal insights): how each morning-journal habit
 * lines up with your recovery. A correlation, said plainly.
 */
export function HabitImpactsCard({ impacts, noWatchData }: HabitImpactsCardProps) {
  return (
    <Card>
      <View style={styles.body}>
        {noWatchData ? (
          <Text variant="callout" color="textMuted">
            Conecta tu reloj (Garmin, COROS o Apple Salud): comparamos tu recuperación de los días que respondes «sí» con los que respondes «no».
          </Text>
        ) : null}
        {impacts.map((impact, i) => (
          <View key={impact.habit}>
            {i > 0 ? <Divider /> : null}
            <ImpactRow impact={impact} />
          </View>
        ))}
        <Text variant="caption" color="textMuted">
          {`Con al menos ${IMPACT_MIN_ANSWERS} «sí» y ${IMPACT_MIN_ANSWERS} «no» en 90 días. Es una relación en tus datos, no una prueba: otras cosas pueden influir.`}
        </Text>
        <Button label="Cambiar preguntas" variant="ghost" size="sm" icon="edit" onPress={() => router.push('/settings/journal')} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  text: { flex: 1, gap: space.xxs },
});
