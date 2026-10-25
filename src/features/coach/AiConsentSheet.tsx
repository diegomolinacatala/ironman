import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorNotice, IconButton, Text, radius, space, useTheme } from '@/ui';

import { AI_PROVIDER, AI_TERMS_NOTE } from './aiConsent';
import { AiSharedDataList } from './AiSharedDataList';

export interface AiConsentSheetProps {
  visible: boolean;
  saving: boolean;
  error: string | null;
  /** Stores the consent and continues with the AI. */
  onAccept: () => void;
  /** Continues without the AI (the rules engine answers). */
  onDecline: () => void;
  /** Closes without sending anything. */
  onClose: () => void;
  /** Opens the privacy screen. */
  onMore: () => void;
}

/** One-time permission sheet shown before the first Coach IA request. */
export function AiConsentSheet({ visible, saving, error, onAccept, onDecline, onClose, onMore }: AiConsentSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sin enviar"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.bgElevated, borderColor: colors.border, paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text variant="overline" color="textMuted">
                Coach IA · Permiso
              </Text>
              <Text variant="title" accessibilityRole="header">
                {`¿Compartimos tus datos con ${AI_PROVIDER}?`}
              </Text>
            </View>
            <IconButton icon="close" accessibilityLabel="Cerrar sin enviar" variant="filled" size={36} onPress={onClose} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text variant="callout">
              {`Para proponerte cambios, el Coach IA envía a ${AI_PROVIDER} (la empresa que crea Claude) un resumen de:`}
            </Text>
            <AiSharedDataList />
            <Text variant="caption" color="textMuted">
              {`${AI_TERMS_NOTE} Puedes retirar el permiso cuando quieras en Yo › Privacidad. Sin permiso, el coach usa el motor de reglas.`}
            </Text>
            <Button label="Más sobre tu privacidad" variant="ghost" size="sm" icon="lock" onPress={onMore} />
          </ScrollView>
          <View style={styles.footer}>
            {error ? <ErrorNotice message={error} /> : null}
            <Button label="Aceptar y continuar" icon="check" size="lg" fullWidth loading={saving} onPress={onAccept} />
            <Button label="Seguir sin IA (motor de reglas)" variant="ghost" disabled={saving} onPress={onDecline} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.md },
  flex: { flex: 1 },
  scroll: { flexGrow: 0 },
  content: { gap: space.md, paddingBottom: space.md },
  footer: { gap: space.xs, paddingTop: space.md },
});
