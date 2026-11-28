import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { HABITS } from '@/domain/habitCatalog';
import type { HabitAnswers, HabitId } from '@/domain/types';
import { Button, Chip, Text, space } from '@/ui';

export interface JournalQuestionsProps {
  questions: readonly HabitId[];
  answers: HabitAnswers;
  onAnswer: (habit: HabitId, value: boolean) => void;
}

/** The morning journal: one yes/no row per question (Whoop-style), and a link to change them. */
export function JournalQuestions({ questions, answers, onAnswer }: JournalQuestionsProps) {
  return (
    <View style={styles.list} accessibilityRole="list">
      {questions.map((id) => (
        <View key={id} style={styles.row} testID={`journal-${id}`}>
          <Text variant="body" style={styles.question}>
            {HABITS[id].question}
          </Text>
          <View style={styles.answers} accessibilityRole="radiogroup" accessibilityLabel={HABITS[id].question}>
            <Chip label="Sí" selected={answers[id] === true} onPress={() => onAnswer(id, true)} />
            <Chip label="No" selected={answers[id] === false} onPress={() => onAnswer(id, false)} />
          </View>
        </View>
      ))}
      <Button
        label="Cambiar preguntas"
        variant="ghost"
        size="sm"
        icon="edit"
        onPress={() => router.push('/settings/journal')}
        accessibilityHint="Elige qué hábitos te preguntamos cada mañana"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  question: { flex: 1 },
  answers: { flexDirection: 'row', gap: space.sm },
});
