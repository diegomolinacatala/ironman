import type { ReactNode } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Icon, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

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

export function SwitchRow({ icon, title, subtitle, value, onChange, disabled, children }: SwitchRowProps) {
  const { colors } = useTheme();
  // react-native-web ignores thumbColor for the "on" state and uses its own props.
  const webColors = Platform.OS === 'web' ? { activeThumbColor: colors.accent, activeTrackColor: colors.text } : {};
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={18} color={colors.text} />
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
          trackColor={{ false: colors.border, true: colors.text }}
          thumbColor={value ? colors.accent : colors.surface}
          ios_backgroundColor={colors.border}
          {...webColors}
        />
      </View>
      {value && children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  extra: { paddingLeft: 34 + space.md, gap: space.sm },
});
