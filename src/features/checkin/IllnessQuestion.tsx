import { Pressable, StyleSheet, View } from 'react-native';

import { ILLNESS_ANSWER_LABELS, illnessQuestion, type IllnessSignal } from '@/domain/illness';
import { ILLNESS_ANSWERS, type IllnessAnswer } from '@/domain/types';
import { Card, Icon, Text, haptics, radius, space, useTheme } from '@/ui';

export interface IllnessQuestionProps {
  /** What is up last night (words the question); null when only an earlier answer is left to edit. */
  signal: Pick<IllnessSignal, 'level' | 'breathingUp' | 'pulseUp' | 'reasons'> | null;
  value: IllnessAnswer | null;
  onChange: (answer: IllnessAnswer) => void;
}

/**
 * The extra morning question when last night's breathing or pulse is above the athlete's
 * baseline (domain/illness.ts). One tap; the answer decides what the app suggests.
 */
export function IllnessQuestion({ signal, value, onChange }: IllnessQuestionProps) {
  const { colors } = useTheme();
  const up = signal && signal.level !== 'none' ? signal : null;
  const question = up ? illnessQuestion(up) : '¿Cómo te encuentras hoy?';
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="md" style={styles.card}>
      <View style={styles.head}>
        <Icon name="illness" size={20} color={colors.onAccentSoft} />
        <Text variant="bodyStrong" color="onAccentSoft" style={styles.question}>
          {question}
        </Text>
      </View>
      {up && up.reasons.length > 0 ? (
        <Text variant="caption" color="onAccentSoft">
          {up.reasons.join(' · ')}
        </Text>
      ) : null}
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={question}>
        {ILLNESS_ANSWERS.map((answer) => (
          <AnswerOption key={answer} label={ILLNESS_ANSWER_LABELS[answer]} selected={value === answer} onPress={() => onChange(answer)} />
        ))}
      </View>
    </Card>
  );
}

function AnswerOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}>
      <Text variant="callout" style={{ color: selected ? colors.onAccent : colors.text }}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={16} color={colors.onAccent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  question: { flex: 1 },
  options: { gap: space.xs + 2 },
  option: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
});
