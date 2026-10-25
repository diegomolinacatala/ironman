import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { IconButton, fonts, radius, space, useTheme } from '@/ui';

import { MAX_MESSAGE_LENGTH } from './requests';

export interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Controlled text: the parent clears it once the message is really sent. */
  value?: string;
  onChangeText?: (text: string) => void;
}

/** Message composer pinned under the conversation. */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Cuéntale al coach cómo va tu semana…',
  value,
  onChangeText,
}: ChatInputProps) {
  const { colors } = useTheme();
  const [ownText, setOwnText] = useState('');
  const controlled = value !== undefined;
  const text = controlled ? value : ownText;
  const setText = (next: string) => (controlled ? onChangeText?.(next) : setOwnText(next));
  const canSend = !disabled && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    if (!controlled) setOwnText('');
  };

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accentInk}
        multiline
        maxLength={MAX_MESSAGE_LENGTH}
        editable={!disabled}
        accessibilityLabel="Mensaje para el coach"
        style={[styles.input, { color: colors.text }]}
        onSubmitEditing={submit}
        submitBehavior="submit"
        returnKeyType="send"
      />
      <IconButton
        icon="send"
        variant={canSend ? 'accent' : 'filled'}
        accessibilityLabel="Enviar mensaje"
        disabled={!canSend}
        onPress={submit}
        size={44}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingTop: 12,
    paddingBottom: 10,
    fontFamily: fonts.body,
    fontSize: 16,
  },
});
