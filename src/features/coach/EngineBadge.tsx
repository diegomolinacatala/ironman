import { StyleSheet, View } from 'react-native';

import { Icon, Text, radius, space, useTheme } from '@/ui';

import type { EngineInfo } from './labels';

/** "IA · Claude" / "Reglas" pill plus a one-line explanation. */
export function EngineBadge({ info }: { info: EngineInfo }) {
  const { colors } = useTheme();
  const isAi = info.kind === 'ai';
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Motor: ${info.label}. ${info.explanation}`}>
      <View
        style={[
          styles.pill,
          isAi
            ? { backgroundColor: colors.inverseBg, borderColor: colors.inverseBg }
            : { backgroundColor: 'transparent', borderColor: colors.borderStrong },
        ]}>
        <Icon name={isAi ? 'sparkles' : 'settings'} size={12} color={isAi ? colors.inverseText : colors.textMuted} />
        <Text variant="overline" style={{ color: isAi ? colors.inverseText : colors.textMuted }}>
          {info.label}
        </Text>
      </View>
      <Text variant="caption" color="textMuted" style={styles.flex}>
        {info.explanation}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  flex: { flex: 1 },
});
