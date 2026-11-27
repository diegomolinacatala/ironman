/** Pure helpers of "Preguntas de la mañana" (choose the journal's habits). */
import { HABITS, HABIT_GROUP_LABELS, JOURNAL_SIZE, type HabitGroup } from '@/domain/habitCatalog';
import { HABIT_IDS, type HabitId } from '@/domain/types';

const GROUP_ORDER: readonly HabitGroup[] = ['sleep', 'nutrition', 'body', 'life'];

export interface HabitSection {
  group: HabitGroup;
  title: string;
  habits: HabitId[];
}

/** The catalogue grouped for the picker, in a stable order. */
export function habitSections(): HabitSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: HABIT_GROUP_LABELS[group],
    habits: HABIT_IDS.filter((id) => HABITS[id].group === group),
  }));
}

/** Adds or removes `id`; adding is ignored once JOURNAL_SIZE are chosen. */
export function toggleHabit(selected: readonly HabitId[], id: HabitId): HabitId[] {
  if (selected.includes(id)) return selected.filter((h) => h !== id);
  return selected.length >= JOURNAL_SIZE ? [...selected] : [...selected, id];
}

/** "3 de 5 elegidas" / "Listo: 5 de 5". */
export function selectionLabel(count: number): string {
  return count === JOURNAL_SIZE ? `Listo: ${count} de ${JOURNAL_SIZE}` : `${count} de ${JOURNAL_SIZE} elegidas`;
}

/** "Alcohol, cena tardía y 3 más" for the Tú row. */
export function habitsSubtitle(habits: readonly HabitId[]): string {
  const labels = habits.map((id) => HABITS[id].label);
  if (labels.length <= 2) return labels.join(' y ');
  return `${labels[0]}, ${labels[1]?.toLowerCase()} y ${labels.length - 2} más`;
}
