import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, radius, space, useTheme } from '@/ui';

import type { CopyState } from './useCopy';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export interface CopyValueProps {
  /** Small label above the value ("Europa"). */
  label?: string;
  value: string;
  /** Shared copy state, so only one row says «Copiado» at a time. */
  clipboard: CopyState;
}

/** A value to paste somewhere else (a URL): tap the row to copy it. */
export function CopyValue({ label, value, clipboard }: CopyValueProps) {
  const { colors } = useTheme();
  const copied = clipboard.copiedKey === value;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copiar${label ? ` ${label}` : ''}: ${value}`}
      onPress={() => void clipboard.copy(value, value)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceAlt, borderColor: colors.border },
      ]}>
      <View style={styles.flex}>
        {label ? (
          <Text variant="caption" color="textMuted">
            {label}
          </Text>
        ) : null}
        <Text selectable style={[styles.mono, { color: colors.accentInk, fontFamily: MONO }]}>
          {value}
        </Text>
      </View>
      <View style={styles.copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} color={copied ? colors.success : colors.textMuted} />
        <Text variant="caption" color={copied ? 'success' : 'textMuted'}>
          {copied ? 'Copiado' : 'Copiar'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  flex: { flex: 1, gap: 2 },
  mono: { fontSize: 13, lineHeight: 19 },
  copy: { alignItems: 'center', gap: 2, minWidth: 48 },
});
