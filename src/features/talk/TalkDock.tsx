import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MAX_MESSAGE_LENGTH } from '@/features/coach/requests';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';
import { Button, Icon, IconButton, Text, fonts, haptics, radius, space, useTheme, type IconName } from '@/ui';

import { MicButton } from './MicButton';
import { FadeIn } from './motion';
import type { InputMode } from './talkSession';
import { micCopy, needsSettings } from './voiceModel';

/** Labelled switch between talking and typing (icon + word, 56 pt). */
function ModeToggle({ icon, label, hint, onPress }: { icon: IconName; label: string; hint: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.toggle, { backgroundColor: pressed ? colors.surfacePressed : 'transparent' }]}>
      <Icon name={icon} size={22} color={colors.text} />
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </Pressable>
  );
}

export function NoticeBanner({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <FadeIn>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.notice, { backgroundColor: colors.inverseBg }]}>
        <Icon name="checkCircle" size={18} color={colors.accent} />
        <Text variant="callout" style={[styles.flex, { color: colors.inverseText }]}>
          {text}
        </Text>
      </View>
    </FadeIn>
  );
}

function VoiceError({ message, onType }: { message: string; onType: () => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.voiceError, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <View style={styles.row}>
        <Icon name="micOff" size={18} color={colors.danger} />
        <Text variant="callout" style={styles.flex}>
          {message}
        </Text>
      </View>
      <View style={styles.row}>
        {needsSettings(message) ? (
          <Button label="Abrir Ajustes" variant="secondary" size="sm" icon="settings" onPress={() => void Linking.openSettings()} />
        ) : null}
        <Button label="Escribir" variant="ghost" size="sm" icon="keyboard" onPress={onType} />
      </View>
    </View>
  );
}

export interface TalkDockProps {
  mode: InputMode;
  voice: VoiceInput;
  sending: boolean;
  /** A proposal waits for its decision: the composer is not the primary action. */
  quiet: boolean;
  draft: string;
  /** Short transient hint replacing the mic caption ("No te he oído…"). */
  hint: string | null;
  notice: string | null;
  onMic: () => void;
  onDraft: (text: string) => void;
  onSendText: () => void;
  onMode: (mode: InputMode) => void;
  onCancel: () => void;
}

function VoiceComposer({ voice, quiet, hint, onMic, onMode }: Pick<TalkDockProps, 'voice' | 'quiet' | 'hint' | 'onMic' | 'onMode'>) {
  return (
    <View style={styles.voice}>
      {voice.error ? <VoiceError message={voice.error} onType={() => onMode('text')} /> : null}
      <View style={styles.micRow}>
        <View style={styles.side} />
        <MicButton state={voice.state} level={voice.level} quiet={quiet} onPress={onMic} />
        <View style={styles.side}>
          <ModeToggle icon="keyboard" label="Escribir" hint="Cambia al teclado" onPress={() => onMode('text')} />
        </View>
      </View>
      <Text variant="callout" color="textMuted" align="center" accessibilityLiveRegion="polite">
        {hint ?? micCopy(voice.state).caption}
      </Text>
    </View>
  );
}

function TextComposer({ voice, quiet, draft, onDraft, onSendText, onMode }: Pick<TalkDockProps, 'voice' | 'quiet' | 'draft' | 'onDraft' | 'onSendText' | 'onMode'>) {
  const { colors } = useTheme();
  const canSend = draft.trim().length > 0;
  return (
    <View style={styles.textRow}>
      {voice.available ? <ModeToggle icon="mic" label="Hablar" hint="Cambia al micrófono" onPress={() => onMode('voice')} /> : null}
      <TextInput
        value={draft}
        onChangeText={onDraft}
        placeholder="Escribe a tu coach…"
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accentInk}
        accessibilityLabel="Mensaje para tu coach"
        multiline
        maxLength={MAX_MESSAGE_LENGTH}
        maxFontSizeMultiplier={1.4}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
      />
      <IconButton
        icon="send"
        variant={quiet ? 'filled' : 'accent'}
        size={50}
        disabled={!canSend}
        accessibilityLabel="Enviar a tu coach"
        onPress={onSendText}
      />
    </View>
  );
}

/** Bottom control: big mic (or keyboard), and "Cancelar" while the coach works. */
export function TalkDock(props: TalkDockProps) {
  const { mode, sending, notice, onCancel } = props;
  return (
    <View style={styles.dock}>
      {notice ? <NoticeBanner text={notice} /> : null}
      {sending ? (
        <Button label="Cancelar" variant="secondary" icon="close" fullWidth accessibilityHint="Deja de esperar la respuesta" onPress={onCancel} />
      ) : mode === 'voice' && props.voice.available ? (
        <VoiceComposer {...props} />
      ) : (
        <TextComposer {...props} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: space.md, paddingTop: space.sm },
  voice: { gap: space.xs, alignItems: 'stretch' },
  micRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  side: { flex: 1, alignItems: 'center' },
  toggle: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.md, padding: space.xs },
  textRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 50,
    maxHeight: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingTop: 14,
    paddingBottom: 12,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  voiceError: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
