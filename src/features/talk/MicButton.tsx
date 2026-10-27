import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { VoiceState } from '@/integrations/speech/useVoiceInput';
import { Icon, useTheme } from '@/ui';

import { PulseRing } from './motion';
import { micCopy } from './voiceModel';

export const MIC_SIZE = 96;
/** Room around the button for the pulsing halo. */
const HALO_FACTOR = 1.7;

export interface MicButtonProps {
  state: VoiceState;
  level: number;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
  /** Another action is the primary one (a proposal waits): plain surface instead of lime. */
  quiet?: boolean;
}

/** The one big control of the voice coach: tap to talk, tap again to finish. */
export function MicButton({ state, level, onPress, size = MIC_SIZE, disabled = false, quiet = false }: MicButtonProps) {
  const { colors } = useTheme();
  const copy = micCopy(state);
  const listening = state === 'listening';
  const busy = state === 'requesting' || state === 'stopping';
  const box = size * HALO_FACTOR;
  const idleBg = quiet ? colors.surface : colors.accent;
  const idlePressed = quiet ? colors.surfacePressed : colors.accentPressed;
  const idleFg = quiet ? colors.text : colors.onAccent;

  return (
    <View style={[styles.box, { width: box, height: box }]}>
      <PulseRing active={listening} level={level} size={size} color={colors.accent} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.label}
        accessibilityHint={copy.hint}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: listening ? colors.inverseBg : pressed ? idlePressed : idleBg,
            borderColor: quiet && !listening ? colors.borderStrong : 'transparent',
            opacity: disabled ? 0.45 : 1,
            transform: [{ scale: pressed ? 0.96 : 1 }],
            shadowColor: colors.shadow,
          },
        ]}>
        {busy ? (
          <ActivityIndicator color={idleFg} />
        ) : (
          <Icon name={listening ? 'stop' : 'mic'} size={size * 0.38} color={listening ? colors.inverseText : idleFg} weight="bold" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  button: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
