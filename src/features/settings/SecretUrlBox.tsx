import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Icon, Text, radius, space, useTheme } from '@/ui';

import { FormLabel } from './FormLabel';

import { useCopy } from './useCopy';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export interface SecretUrlBoxProps {
  url: string;
  /** Shown above the URL, e.g. "Tu URL personal". */
  label: string;
  /** Warning shown under the box (the URL acts like a password). */
  warning?: string;
  /** Extra actions rendered next to "Copiar". */
  children?: ReactNode;
}

/** Monospace box showing a secret URL ONCE, with a copy button and a warning. */
export function SecretUrlBox({ url, label, warning, children }: SecretUrlBoxProps) {
  const { colors } = useTheme();
  const { copiedKey, error, copy } = useCopy();
  const copied = copiedKey === 'url';
  return (
    <View style={styles.wrap}>
      <FormLabel>{label}</FormLabel>
      <View style={[styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Text
          selectable
          accessibilityLabel={`${label}: ${url}`}
          style={[styles.mono, { color: colors.text, fontFamily: MONO }]}>
          {url}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          label={copied ? 'Copiado' : 'Copiar'}
          icon={copied ? 'check' : 'copy'}
          variant={copied ? 'secondary' : 'primary'}
          onPress={() => void copy(url, 'url')}
        />
        {children}
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      {warning ? (
        <View style={[styles.warning, { backgroundColor: `${colors.warning}1A`, borderColor: `${colors.warning}66` }]}>
          <Icon name="lock" size={14} color={colors.warning} />
          <Text variant="caption" style={{ flex: 1, color: colors.text }}>
            {warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  box: { borderRadius: radius.md, padding: space.md, borderWidth: StyleSheet.hairlineWidth },
  mono: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  warning: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, borderWidth: 1 },
});
