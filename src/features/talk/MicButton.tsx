import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import type { VoiceState } from '@/integrations/speech/useVoiceInput';
import { Icon, useTheme, type Theme } from '@/ui';

import { PulseRing } from './motion';
import { micCopy } from './voiceModel';

export const MIC_SIZE = 96;
/** Room around the button for the pulsing halo. */
const HALO_FACTOR = 1.7;
/** Listening: the button shrinks a touch while the halo breathes (transform only, no layout shift). */
const LISTENING_SCALE = 0.94;
const PRESSED_SCALE = 0.96;

export interface MicButtonProps {
  state: VoiceState;
  level: number;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
  /** Another action is the primary one (a proposal waits): plain surface instead of the accent fill. */
  quiet?: boolean;
}

interface MicTone {
  bg: string;
  pressed: string;
  fg: string;
  border: string;
}

/** Accent fill (navy / sky in dark); quiet = surface + border. Listening always uses the accent. */
function micTone({ colors }: Theme, quiet: boolean, listening: boolean): MicTone {
  if (quiet && !listening) {
    return { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.text, border: colors.borderStrong };
  }
  return { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: 'transparent' };
}

/** Soft lift in light mode only; dark mode separates with the halo and surface steps. */
function liftStyle({ colors, isDark }: Theme, quiet: boolean): ViewStyle {
  if (isDark || quiet) return {};
  return { shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 };
}

/** The one big control of the voice coach: tap to talk, tap again to finish. */
export function MicButton({ state, level, onPress, size = MIC_SIZE, disabled = false, quiet = false }: MicButtonProps) {
  const theme = useTheme();
  const copy = micCopy(state);
  const listening = state === 'listening';
  const busy = state === 'requesting' || state === 'stopping';
  const box = size * HALO_FACTOR;
  const tone = micTone(theme, quiet, listening);

  return (
    <View style={[styles.box, { width: box, height: box }]}>
      <PulseRing active={listening} level={level} size={size} color={theme.colors.accent} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.label}
        accessibilityHint={copy.hint}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          liftStyle(theme, quiet),
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: pressed ? tone.pressed : tone.bg,
            borderColor: tone.border,
            opacity: disabled ? 0.45 : 1,
            transform: [{ scale: pressed ? PRESSED_SCALE : listening ? LISTENING_SCALE : 1 }],
          },
        ]}>
        {busy ? (
          <ActivityIndicator color={tone.fg} />
        ) : (
          <Icon name={listening ? 'stop' : 'mic'} size={size * 0.36} color={tone.fg} weight="semibold" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  button: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
