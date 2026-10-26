import { StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Icon, Text, radius, space, useTheme } from '@/ui';

/** Ink hero for "Conecta tu Claude": the idea in two lines + the three-way flow. */
export function ClaudeHero() {
  const { colors, isDark } = useTheme();
  const ink = isDark ? colors.bgElevated : colors.inverseBg;
  const paper = isDark ? colors.text : colors.inverseText;
  return (
    <View style={[styles.hero, { backgroundColor: ink }]}>
      <View style={styles.stripes} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width={84} height={64} viewBox="0 0 120 110">
          <Polygon points="50,0 80,0 40,110 10,110" fill={colors.accent} opacity={0.9} />
          <Polygon points="92,0 108,0 68,110 52,110" fill={colors.accent} opacity={0.45} />
        </Svg>
      </View>
      <Text variant="overline" style={{ color: colors.accent }}>
        Tu Claude, tu entrenador
      </Text>
      <Text variant="display" style={{ color: paper }}>
        Tu Claude ya lee tu Garmin.{'\n'}Ahora también tu semana.
      </Text>
      <Text variant="callout" style={{ color: paper, opacity: 0.8 }}>
        Conéctalo a Road to Ironman y podrá leer tu plan, tus huecos y tus imprevistos, y proponerte cambios. Tú los apruebas aquí,
        uno a uno.
      </Text>
      <View style={styles.flow} accessible accessibilityLabel="Garmin, tu Claude y tu plan de Road to Ironman conectados">
        <FlowNode icon="watch" label="Garmin" paper={paper} />
        <Icon name="chevronRight" size={14} color={colors.accent} />
        <FlowNode icon="sparkles" label="Tu Claude" paper={paper} />
        <Icon name="move" size={14} color={colors.accent} />
        <FlowNode icon="week" label="Tu plan" paper={paper} />
      </View>
    </View>
  );
}

function FlowNode({ icon, label, paper }: { icon: 'watch' | 'sparkles' | 'week'; label: string; paper: string }) {
  return (
    <View style={styles.node}>
      <Icon name={icon} size={18} color={paper} />
      <Text variant="caption" style={{ color: paper }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.md, overflow: 'hidden' },
  stripes: { position: 'absolute', top: 0, right: -8, opacity: 0.9 },
  flow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  node: { alignItems: 'center', gap: 2, minWidth: 56 },
});
