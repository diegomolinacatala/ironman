import { StyleSheet, View } from 'react-native';

import { Icon, Text, radius, space, useTheme } from '@/ui';

const POINTS: { icon: 'week' | 'bolt' | 'together'; text: string }[] = [
  { icon: 'week', text: 'Planifica tu semana con tus horas, tus clases y tu fase de temporada.' },
  { icon: 'bolt', text: 'Reorganiza cuando surge un pádel, una sobrecarga o un pico de trabajo.' },
  { icon: 'together', text: 'Respeta tus quedadas y tus sesiones clave. Nada cambia sin tu visto bueno.' },
];

/** Empty-conversation explainer. */
export function CoachIntro() {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="overline" color="textMuted">
        Tu coach
      </Text>
      <Text variant="title">¿Qué hacemos con tu semana?</Text>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.icon} style={styles.point}>
            <Icon name={p.icon} size={16} color={colors.text} />
            <Text variant="callout" style={styles.flex}>
              {p.text}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" color="textMuted">
        Elige una acción rápida de abajo o escríbele lo que necesites.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  points: { gap: space.sm, marginVertical: space.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
});
