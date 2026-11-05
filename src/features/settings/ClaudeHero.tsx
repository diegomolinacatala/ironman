import { StyleSheet, View } from 'react-native';

import { Icon, Text, iconSize, radius, space, useTheme, type IconName } from '@/ui';

/** Calm brand panel for "Conecta tu Claude": the idea in two lines + the three-way flow. */
export function ClaudeHero() {
  const { colors } = useTheme();
  const ink = colors.onAccentSoft;
  return (
    <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
      <Text variant="overline" color="accentInk">
        Tu Claude, tu entrenador
      </Text>
      <Text variant="title" style={{ color: ink }}>
        Tu Claude ya lee tu Garmin. Ahora también tu semana.
      </Text>
      <Text variant="callout" color="textMuted">
        Conéctalo a Road to Ironman y podrá leer tu plan, tus huecos y tus imprevistos, y proponerte cambios. Tú los apruebas aquí,
        uno a uno.
      </Text>
      <View style={styles.flow} accessible accessibilityLabel="Garmin, tu Claude y tu plan de Road to Ironman conectados">
        <FlowNode icon="watch" label="Garmin" />
        <Icon name="chevronRight" size={iconSize.sm - 2} color={colors.textMuted} />
        <FlowNode icon="sparkles" label="Tu Claude" />
        <Icon name="move" size={iconSize.sm - 2} color={colors.textMuted} />
        <FlowNode icon="week" label="Tu plan" />
      </View>
    </View>
  );
}

function FlowNode({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.node}>
      <View style={[styles.tile, { backgroundColor: colors.surface }]}>
        <Icon name={icon} size={18} color={colors.accentInk} />
      </View>
      <Text variant="caption" style={{ color: colors.onAccentSoft }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.md },
  flow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' },
  node: { alignItems: 'center', gap: space.xs, minWidth: 56 },
  tile: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
