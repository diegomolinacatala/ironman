import { StyleSheet, View } from 'react-native';

import { Icon, Text, radius, space, useTheme, type IconName } from '@/ui';

import type { StatusTone } from './garminModel';

const TONE_ICON: Record<StatusTone, IconName> = {
  success: 'checkCircle',
  warning: 'warning',
  danger: 'warning',
  muted: 'link',
};

/** Connection status pill: colour + icon + text (colour is never the only signal). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const { colors } = useTheme();
  const color = tone === 'muted' ? colors.textMuted : colors[tone];
  return (
    <View
      accessibilityLabel={`Estado: ${label}`}
      style={[styles.pill, { backgroundColor: `${color}1A`, borderColor: `${color}55` }]}>
      <Icon name={TONE_ICON[tone]} size={12} color={color} />
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
