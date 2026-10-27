import { StyleSheet, View } from 'react-native';

import { Chip, Text, space } from '@/ui';

import { FadeIn } from './motion';
import { EXAMPLE_PROMPTS } from './talkSession';

export interface TalkGreetingProps {
  /** Hide the examples while the mic is live. */
  showExamples: boolean;
  onPick: (text: string) => void;
}

/** Empty conversation: one question, three examples that prefill the composer. */
export function TalkGreeting({ showExamples, onPick }: TalkGreetingProps) {
  return (
    <View style={styles.root}>
      <FadeIn index={0}>
        <Text variant="display" accessibilityRole="header">
          ¿Qué te cuentas?
        </Text>
      </FadeIn>
      <FadeIn index={1}>
        <Text variant="body" color="textMuted">
          Cuéntaselo como a tu entrenador: molestias, cambios de horario, lo que prefieres. Yo ajusto tu plan.
        </Text>
      </FadeIn>
      {showExamples ? (
        <FadeIn index={2} style={styles.examples}>
          <Text variant="overline" color="textMuted">
            Por ejemplo
          </Text>
          <View style={styles.chips}>
            {EXAMPLE_PROMPTS.map((prompt) => (
              <Chip key={prompt} label={prompt} onPress={() => onPick(prompt)} />
            ))}
          </View>
        </FadeIn>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md, paddingTop: space.xl },
  examples: { gap: space.sm, marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
