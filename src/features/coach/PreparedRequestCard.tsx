import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, radius, space, useTheme } from '@/ui';

import type { PreparedRequest } from './requests';

export interface PreparedRequestCardProps {
  prepared: PreparedRequest;
  disabled: boolean;
  onSend: () => void;
  onDismiss: () => void;
}

/**
 * Request prefilled from a link or notification (`/coach?mode&message…`).
 * Links can come from outside the app, so nothing is sent without this tap.
 */
export function PreparedRequestCard({ prepared, disabled, onSend, onDismiss }: PreparedRequestCardProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={`Petición preparada: ${prepared.text}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
      <View style={styles.head}>
        <Icon name="send" size={14} color={colors.textMuted} />
        <Text variant="overline" color="textMuted">
          ¿Se lo enviamos al coach?
        </Text>
      </View>
      <Text variant="bodyStrong" selectable>
        {`“${prepared.text}”`}
      </Text>
      <Text variant="caption" color="textMuted">
        Revisa la petición: no se envía nada hasta que pulses Enviar.
      </Text>
      <View style={styles.actions}>
        <Button label="Enviar al coach" icon="send" onPress={onSend} disabled={disabled} style={styles.flex} />
        <Button label="Descartar" variant="ghost" onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  flex: { flex: 1 },
});
