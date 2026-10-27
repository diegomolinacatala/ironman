import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { needsSettings, isLive, micCopy } from '@/features/talk/voiceModel';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';
import { Button, Icon, Text, TextField, radius, space, useTheme } from '@/ui';

import { MAX_MEAL_TEXT } from './mealForm';

function DictateButton({ voice, onPress }: { voice: VoiceInput; onPress: () => void }) {
  const { colors } = useTheme();
  const listening = voice.state === 'listening';
  // A take is starting or finishing: a second tap would start another recognition.
  const busy = voice.state === 'requesting' || voice.state === 'stopping';
  const copy = micCopy(voice.state);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Terminar de dictar' : 'Dictar la comida'}
      accessibilityHint={copy.hint}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mic,
        {
          backgroundColor: listening ? colors.inverseBg : pressed ? colors.surfacePressed : colors.surface,
          borderColor: colors.borderStrong,
          opacity: busy ? 0.5 : 1,
        },
      ]}>
      <Icon name={listening ? 'stop' : 'mic'} size={22} color={listening ? colors.inverseText : colors.text} />
    </Pressable>
  );
}

export interface DescribeMealProps {
  text: string;
  voice: VoiceInput;
  onText: (text: string) => void;
  onMic: () => void;
}

/** "Descríbela": type or dictate the meal; analysed without a photo. */
export function DescribeMeal({ text, voice, onText, onMic }: DescribeMealProps) {
  const live = isLive(voice.state);
  return (
    <View style={styles.root}>
      <Text variant="title" accessibilityRole="header">
        Cuéntame qué has comido
      </Text>
      <Text variant="callout" color="textMuted">
        Con cantidades aproximadas me basta: «un plato grande de pasta con atún y un yogur».
      </Text>
      <View style={styles.inputRow}>
        <View style={styles.flex}>
          <TextField
            label="Tu comida"
            value={text}
            onChangeText={onText}
            placeholder="Pasta con atún, un plato grande…"
            multiline
            maxLength={MAX_MEAL_TEXT}
            autoFocus={!voice.available}
          />
        </View>
        {voice.available ? <DictateButton voice={voice} onPress={onMic} /> : null}
      </View>
      {live ? (
        <Text variant="heading" color={voice.transcript ? 'text' : 'textFaint'} accessibilityLiveRegion="polite">
          {voice.transcript || 'Te escucho…'}
        </Text>
      ) : null}
      {voice.error ? (
        <View style={styles.error}>
          <Text variant="caption" color="danger">
            {voice.error}
          </Text>
          {needsSettings(voice.error) ? (
            <Button label="Abrir Ajustes" variant="secondary" size="sm" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  flex: { flex: 1 },
  mic: { width: 56, height: 56, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  error: { gap: space.sm, alignItems: 'flex-start' },
});
