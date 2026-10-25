import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { Button, Card, Icon, Text, space, useTheme } from '@/ui';

/** Shown instead of the hero when there is nothing left to do today. */
export function DayStatusCard({ kind, today }: { kind: 'rest' | 'done'; today: ISODate }) {
  const { colors } = useTheme();
  const isRest = kind === 'rest';
  return (
    <Card variant={isRest ? 'tinted' : 'flat'} padding="lg" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: isRest ? colors.surface : `${colors.success}22` }]}>
          <Icon name={isRest ? 'moon' : 'checkCircle'} size={24} color={isRest ? colors.text : colors.success} />
        </View>
        <View style={styles.body}>
          <Text variant="title">{isRest ? 'Hoy toca descanso' : '¡Hecho por hoy!'}</Text>
          <Text variant="callout" color="textMuted">
            {isRest
              ? 'El descanso también es entrenamiento: duerme bien, come rico y estira un poco.'
              : 'Buen trabajo. Apunta cómo te has sentido para que el plan se ajuste mejor.'}
          </Text>
        </View>
      </View>
      {isRest ? (
        <Button
          label="Añadir entreno"
          icon="add"
          variant="secondary"
          size="sm"
          onPress={() => router.push(`/workout/edit?date=${today}`)}
          style={styles.cta}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: space.xs },
  cta: { alignSelf: 'flex-start' },
});
