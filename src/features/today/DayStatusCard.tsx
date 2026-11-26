import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { Button, Card, Icon, Text, radius, space, useTheme, type IconName } from '@/ui';

const STATES = {
  rest: { icon: 'moon', title: 'Hoy toca descanso', detail: 'Tu plan reserva este día para recuperar.' },
  free: { icon: 'week', title: 'Hoy tienes el día libre', detail: 'No hay sesiones en tu plan para hoy.' },
  finished: { icon: 'checkCircle', title: 'Hecho por hoy', detail: 'Has registrado todos los entrenos de hoy.' },
  skipped: { icon: 'week', title: 'Día cerrado', detail: 'Ya no quedan sesiones pendientes hoy.' },
} as const satisfies Record<string, { icon: IconName; title: string; detail: string }>;

export function DayStatusCard({ kind, today }: { kind: keyof typeof STATES; today: ISODate }) {
  const { colors } = useTheme();
  const { icon, title, detail } = STATES[kind];
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="xl" style={styles.hero}>
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        <Icon name={icon} size={24} color={colors.accentInk} />
      </View>
      <View style={styles.body}>
        <Text variant="display" accessibilityRole="header">{title}</Text>
        <Text variant="callout" color="onAccentSoft">{detail}</Text>
      </View>
      <View style={styles.actions}>
        <Button label="Ver mi semana" iconRight="arrowRight" onPress={() => router.navigate('/week')} />
        {kind === 'rest' || kind === 'free' ? (
          <Button label="Añadir entreno" variant="ghost" onPress={() => router.push(`/workout/edit?date=${today}`)} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, gap: space.lg },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
