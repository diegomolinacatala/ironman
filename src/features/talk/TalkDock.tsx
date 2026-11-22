import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MAX_MESSAGE_LENGTH } from '@/features/coach/requests';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';
import { Button, Icon, IconButton, Text, fonts, radius, space, useTheme } from '@/ui';

import { FadeIn } from './motion';
import type { InputMode } from './talkSession';
import { micCopy, needsSettings } from './voiceModel';

export function NoticeBanner({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <FadeIn>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.notice, { backgroundColor: colors.accentSoft }]}>
        <Icon name="checkCircle" size={18} color={colors.accentInk} />
        <Text variant="callout" color="onAccentSoft" style={styles.flex}>
          {text}
        </Text>
      </View>
    </FadeIn>
  );
}

function VoiceError({ message, onType }: { message: string; onType: () => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.voiceError, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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

/** Mic inside the composer: tap to dictate, tap again to send what you said. */
function InlineMic({ voice, onMic }: Pick<TalkDockProps, 'voice' | 'onMic'>) {
  const { colors } = useTheme();
  const copy = micCopy(voice.state);
  const live = voice.state === 'listening' || voice.state === 'requesting' || voice.state === 'stopping';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.label}
      accessibilityHint={copy.hint}
      accessibilityState={{ busy: voice.state === 'requesting' || voice.state === 'stopping' }}
      onPress={onMic}
      hitSlop={6}
      style={({ pressed }) => [
        styles.mic,
        { backgroundColor: live ? colors.danger : pressed ? colors.surfacePressed : colors.surfaceAlt },
      ]}>
      <Icon name={live ? 'stop' : 'mic'} size={20} color={live ? colors.onAccent : colors.accentInk} />
    </Pressable>
  );
}

function Composer({ voice, quiet, draft, hint, onDraft, onSendText, onMic }: Pick<TalkDockProps, 'voice' | 'quiet' | 'draft' | 'hint' | 'onDraft' | 'onSendText' | 'onMic'>) {
  const { colors } = useTheme();
  const canSend = draft.trim().length > 0;
  const listening = voice.state === 'listening';
  return (
    <View style={styles.composer}>
      {hint || listening ? (
        <Text variant="caption" color="textMuted" align="center" accessibilityLiveRegion="polite">
          {hint ?? micCopy(voice.state).caption}
        </Text>
      ) : null}
      <View style={styles.textRow}>
        {voice.available ? <InlineMic voice={voice} onMic={onMic} /> : null}
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
          icon="arrowUp"
          variant={quiet ? 'filled' : 'accent'}
          size={44}
          disabled={!canSend}
          accessibilityLabel="Enviar a tu coach"
          onPress={onSendText}
        />
      </View>
    </View>
  );
}

/** Bottom control: one messenger-style composer (mic + text + send), "Cancelar" while the coach works. */
export function TalkDock(props: TalkDockProps) {
  const { sending, notice, onCancel, voice, onMode } = props;
  return (
    <View style={styles.dock}>
      {notice ? <NoticeBanner text={notice} /> : null}
      {voice.error ? <VoiceError message={voice.error} onType={() => onMode('text')} /> : null}
      {sending ? (
        <Button label="Cancelar" variant="secondary" icon="close" fullWidth accessibilityHint="Deja de esperar la respuesta" onPress={onCancel} />
      ) : (
        <Composer {...props} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: space.md, paddingTop: space.sm },
  composer: { gap: space.xs },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  textRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: 11,
    paddingBottom: 10,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  voiceError: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
