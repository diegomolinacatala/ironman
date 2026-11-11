import { Pressable, StyleSheet, View } from 'react-native';

import type { WatchBrand } from '@/domain/types';
import { Icon, Text, radius, space, useTheme } from '@/ui';

import { COROS_CLAUDE_PROMPTS } from './corosContent';
import { useCopy } from './useCopy';

const PADEL_PROMPT = 'Hoy he jugado al pádel 90’ a tope, reorganiza mi semana';

/** Example prompts for a Garmin athlete (Garmin connector + Road to Ironman). */
export const CLAUDE_PROMPTS: readonly string[] = [
  'Planifica mi semana en Road to Ironman con mis datos de Garmin y mis huecos',
  PADEL_PROMPT,
  'Guarda en Road to Ironman mi VFC, Body Battery y Training Readiness de Garmin de hoy',
  'Sube a mi Garmin los entrenos de mañana',
];

const COROS_PROMPTS: readonly string[] = [
  'Planifica mi semana en Road to Ironman con mis datos de COROS y mis huecos',
  PADEL_PROMPT,
  ...COROS_CLAUDE_PROMPTS,
];

/** What to ask your Claude, for your watch. */
export function claudePrompts(brand: WatchBrand): readonly string[] {
  return brand === 'coros' ? COROS_PROMPTS : CLAUDE_PROMPTS;
}

/** Example prompts for the user's Claude, each with a copy button. */
export function PromptList({ prompts = CLAUDE_PROMPTS }: { prompts?: readonly string[] }) {
  const { colors } = useTheme();
  const { copiedKey, error, copy } = useCopy();
  return (
    <View style={styles.wrap}>
      {prompts.map((prompt) => {
        const copied = copiedKey === prompt;
        return (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            accessibilityLabel={`Copiar: ${prompt}`}
            accessibilityHint="Copia la frase para pegarla en Claude"
            onPress={() => void copy(prompt, prompt)}
            style={({ pressed }) => [
              styles.prompt,
              { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceAlt, borderColor: colors.border },
            ]}>
            <Text variant="callout" style={styles.flex}>
              “{prompt}”
            </Text>
            <View style={styles.copy}>
              <Icon name={copied ? 'check' : 'copy'} size={16} color={copied ? colors.success : colors.textMuted} />
              <Text variant="caption" color={copied ? 'success' : 'textMuted'}>
                {copied ? 'Copiado' : 'Copiar'}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  flex: { flex: 1 },
  copy: { alignItems: 'center', gap: 2, minWidth: 48 },
});
