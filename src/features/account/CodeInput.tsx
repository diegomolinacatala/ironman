import { useState, type Ref } from 'react';
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
 * Single text input for the 6-digit email code: large letter-spaced tabular
 * numbers, iOS one-time-code autofill, digits only.
 */
export function CodeInput({ value, onChange, error, editable = true, ref }: CodeInputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const complete = value.length === CODE_LENGTH;
  const borderColor = error ? colors.danger : focused || complete ? colors.accentInk : colors.borderStrong;
  return (
    <View style={styles.wrap}>
      <Text variant="caption" color="textMuted" nativeID="code-label" style={styles.label}>
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
        placeholderTextColor={colors.textFaint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={colors.accentInk}
        accessibilityLabel="Código de 6 dígitos"
        accessibilityLabelledBy="code-label"
        maxFontSizeMultiplier={1.2}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor,
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
  label: { fontFamily: fonts.bodySemibold },
  input: {
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 40,
    letterSpacing: 12,
    textAlign: 'center',
  },
});
