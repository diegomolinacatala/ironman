import type { Ref } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';

import { Text, fonts, radius, space, useTheme } from '@/ui';

export const CODE_LENGTH = 6;

export interface CodeInputProps {
  value: string;
  onChange: (digits: string) => void;
  error?: string | null;
  editable?: boolean;
  ref?: Ref<TextInputInstance>;
}

/**
 * Single text input for the 6-digit email code: big letter-spaced condensed
 * numbers, iOS one-time-code autofill, digits only.
 */
export function CodeInput({ value, onChange, error, editable = true, ref }: CodeInputProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="overline" color="textMuted" nativeID="code-label">
        Código de 6 dígitos
      </Text>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        editable={editable}
        autoFocus
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        textContentType="oneTimeCode"
        maxLength={CODE_LENGTH}
        placeholder="000000"
        placeholderTextColor={colors.border}
        selectionColor={colors.accentInk}
        accessibilityLabel="Código de 6 dígitos"
        accessibilityLabelledBy="code-label"
        maxFontSizeMultiplier={1.2}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : value.length === CODE_LENGTH ? colors.text : colors.border,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    minHeight: 84,
    borderRadius: radius.lg,
    borderWidth: 2,
    paddingHorizontal: space.lg,
    fontFamily: fonts.displayItalic,
    fontSize: 52,
    letterSpacing: 14,
    textAlign: 'center',
  },
});
