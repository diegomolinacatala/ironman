import { describe, expect, test } from '@jest/globals';

import { HABIT_IDS } from '@/domain/types';

import { habitSections, habitsSubtitle, selectionLabel, toggleHabit } from '../journalHabitsModel';

describe('journal habits picker', () => {
  test('every habit appears once across the sections', () => {
    const all = habitSections().flatMap((s) => s.habits);
    expect([...all].sort()).toEqual([...HABIT_IDS].sort());
  });

  test('toggle adds up to five and removes', () => {
    const four = toggleHabit(['alcohol', 'nap', 'sick'], 'travel');
    expect(four).toEqual(['alcohol', 'nap', 'sick', 'travel']);
    const five = toggleHabit(four, 'sauna');
    expect(toggleHabit(five, 'meditation')).toEqual(five);
    expect(toggleHabit(five, 'nap')).toEqual(['alcohol', 'sick', 'travel', 'sauna']);
  });

  test('labels', () => {
    expect(selectionLabel(3)).toBe('3 de 5 elegidas');
    expect(selectionLabel(5)).toBe('Listo: 5 de 5');
    expect(habitsSubtitle(['alcohol', 'late_meal', 'nap', 'sick', 'travel'])).toBe('Alcohol, cena tardía y 3 más');
    expect(habitsSubtitle(['alcohol'])).toBe('Alcohol');
  });
});
