import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon, Text, TextField, space, useTheme } from '@/ui';

import { sanitizeUsername } from './format';
import type { UsernameCheck } from './useUsernameCheck';

export interface UsernameFieldProps {
  value: string;
  onChange: (username: string) => void;
  check: UsernameCheck;
  label?: string;
}

/** "@usuario" input: sanitises as you type and shows the availability status. */
export function UsernameField({ value, onChange, check, label = 'Usuario' }: UsernameFieldProps) {
  const fieldError = value.length > 0 ? check.error : null;
  const takenError = check.available === false ? 'Ese usuario ya está cogido. Prueba otro.' : null;
  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        value={value}
        placeholder="tu.usuario"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        maxLength={24}
        error={fieldError ?? takenError}
        onChangeText={(text) => onChange(sanitizeUsername(text))}
      />
      {!fieldError && !takenError ? <UsernameStatus value={value} check={check} /> : null}
    </View>
  );
}

function UsernameStatus({ value, check }: { value: string; check: UsernameCheck }) {
  const { colors } = useTheme();
  if (!value) {
    return (
      <Text variant="caption" color="textMuted">
        3–24 caracteres: minúsculas, números, punto o guion bajo.
      </Text>
    );
  }
  if (check.checking) {
    return (
      <View style={styles.status} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text variant="caption" color="textMuted">
          Comprobando @{value}…
        </Text>
      </View>
    );
  }
  if (check.available === true) {
    return (
      <View style={styles.status} accessibilityLiveRegion="polite">
        <Icon name="checkCircle" size={14} color={colors.success} />
        <Text variant="caption" color="success">
          @{value} está libre
        </Text>
      </View>
    );
  }
  return (
    <Text variant="caption" color="textMuted">
      No hemos podido comprobarlo ahora; lo validaremos al guardar.
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
