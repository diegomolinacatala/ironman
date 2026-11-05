import type { ReactNode } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Icon, Text, haptics, space, useTheme, type IconName } from '@/ui';

export interface SwitchRowProps {
  icon: IconName;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Extra controls shown under the row while enabled (times, chips…). */
  children?: ReactNode;
}

const TILE = 32;

/** Settings row with an icon tile and a switch (accent track when on). */
export function SwitchRow({ icon, title, subtitle, value, onChange, disabled, children }: SwitchRowProps) {
  const { colors } = useTheme();
  // iOS keeps its native white thumb; react-native-web ignores thumbColor for "on" and uses its own props.
  const thumbColor = Platform.OS === 'ios' ? undefined : value ? colors.onAccent : colors.surface;
  const webColors = Platform.OS === 'web' ? { activeThumbColor: colors.onAccent, activeTrackColor: colors.accent } : {};
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={18} color={colors.textMuted} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        </View>
        <Switch
          accessibilityLabel={title}
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            haptics.tap();
            onChange(next);
          }}
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
          thumbColor={thumbColor}
          ios_backgroundColor={colors.borderStrong}
          {...webColors}
        />
      </View>
      {value && children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space.md, paddingHorizontal: space.xs, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: TILE, height: TILE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  extra: { paddingLeft: TILE + space.md, gap: space.sm },
});
