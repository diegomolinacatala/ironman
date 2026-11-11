import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, fonts, radius, space, useTheme, type IconName } from '@/ui';

export interface StatusLineProps {
  icon: IconName;
  text: string;
  action?: { label: string; onPress: () => void; hint?: string };
}

/** Quiet one-line outcome under a coach answer ("Propuesta ya revisada.", "Guardado en tu plan general."). */
export function StatusLine({ icon, text, action }: StatusLineProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.status, { backgroundColor: colors.surfaceAlt }]}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text variant="callout" color="textMuted" style={styles.flex}>
        {text}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityHint={action.hint} hitSlop={12} onPress={action.onPress} style={styles.action}>
          <Text variant="callout" color="accentInk" style={styles.semibold}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  flex: { flex: 1 },
  semibold: { fontFamily: fonts.bodySemibold },
  action: { minHeight: 32, justifyContent: 'center' },
});
