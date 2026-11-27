import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HABITS, JOURNAL_SIZE, journalHabitsOf } from '@/domain/habitCatalog';
import type { HabitId, Profile } from '@/domain/types';
import { useUpdateProfile } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Chip, ErrorNotice, Text, haptics, space } from '@/ui';

import { habitSections, selectionLabel, toggleHabit } from './journalHabitsModel';

/** "Preguntas de la mañana": pick the JOURNAL_SIZE habits the check-in asks about. */
export function JournalHabitsPicker({ profile }: { profile: Profile }) {
  const [selected, setSelected] = useState<HabitId[]>(() => journalHabitsOf(profile));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateProfile();
  const complete = selected.length === JOURNAL_SIZE;

  const toggle = (id: HabitId) => {
    setError(null);
    setSelected((prev) => toggleHabit(prev, id));
  };

  const save = async () => {
    try {
      await update.mutateAsync({ journalHabits: selected });
      haptics.success();
      router.back();
    } catch (e) {
      logger.warn('journal habits: save failed', e);
      haptics.warning();
      setError(errorMessage(e, 'No hemos podido guardar tus preguntas. Inténtalo de nuevo.'));
    }
  };

  return (
    <View style={styles.root}>
      <Text variant="callout" color="textMuted">
        {`Elige ${JOURNAL_SIZE} hábitos. Cada mañana te preguntamos por ellos y, con 5 «sí» y 5 «no», vemos si se notan en tu recuperación.`}
      </Text>
      {habitSections().map((section) => (
        <View key={section.group} style={styles.section}>
          <Text variant="bodyStrong">{section.title}</Text>
          <View style={styles.chips}>
            {section.habits.map((id) => (
              <Chip
                key={id}
                label={HABITS[id].label}
                selected={selected.includes(id)}
                disabled={!selected.includes(id) && complete}
                onPress={() => toggle(id)}
              />
            ))}
          </View>
        </View>
      ))}
      {error ? <ErrorNotice message={error} /> : null}
      <Text variant="caption" color={complete ? 'text' : 'textMuted'}>
        {selectionLabel(selected.length)}
      </Text>
      <Button
        label="Guardar preguntas"
        icon="check"
        size="lg"
        fullWidth
        disabled={!complete}
        loading={update.isPending}
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
