import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ProgressBar, Text, space, useTheme } from '@/ui';

import type { VolumeWeek } from './volumeModel';

function duration(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function WeekActivity({ week }: { week: VolumeWeek }) {
  const { colors } = useTheme();
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="lg" style={styles.card}>
      <View style={styles.main}>
        <Text variant="heading" color="onAccentSoft" accessibilityRole="header">Tiempo entrenado esta semana</Text>
        <Text variant="hero" color="onAccentSoft">{duration(week.completedMin)}</Text>
      </View>
      {week.plannedMin > 0 ? (
        <View style={styles.plan}>
          <ProgressBar value={week.completedMin / week.plannedMin} accessibilityLabel="Tiempo entrenado respecto al plan semanal" height={6} />
          <Text variant="callout" color="onAccentSoft">{`Tiempo previsto · ${duration(week.plannedMin)}`}</Text>
        </View>
      ) : week.completedMin === 0 ? (
        <Text variant="callout" color="onAccentSoft">Aquí verás el tiempo de tus entrenos registrados.</Text>
      ) : null}
      <Button
        label="Ver mi semana"
        iconRight="chevronRight"
        variant="secondary"
        size="sm"
        style={styles.link}
        onPress={() => router.navigate({ pathname: '/week', params: { view: 'week', week: week.weekStart } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  main: { gap: space.xs },
  plan: { gap: space.sm },
  link: { alignSelf: 'flex-start' },
});
