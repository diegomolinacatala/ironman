import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Text, radius, space, useTheme } from '@/ui';

export interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Small uppercase line above the title. */
  overline?: string;
  children: ReactNode;
  /** Pinned under the scrollable content (primary action). */
  footer?: ReactNode;
}

/** Bottom sheet built on RN `Modal` (works on iOS, Android and web). */
export function SheetModal({ visible, onClose, title, overline, children, footer }: SheetModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.bgElevated, borderColor: colors.border, paddingBottom: insets.bottom + space.lg },
          ]}>
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              {overline ? (
                <Text variant="overline" color="textMuted">
                  {overline}
                </Text>
              ) : null}
              <Text variant="title" accessibilityRole="header">
                {title}
              </Text>
            </View>
            <IconButton icon="close" accessibilityLabel="Cerrar" variant="filled" size={36} onPress={onClose} />
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.md },
  headerText: { flex: 1, gap: 2 },
  scroll: { flexGrow: 0 },
  content: { gap: space.lg, paddingBottom: space.md },
  footer: { paddingTop: space.md },
});
