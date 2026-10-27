import { describe, expect, test } from '@jest/globals';

import type { NutritionLog } from '@/domain/types';
import { makeWorkout } from '@/features/workouts/__tests__/fixtures';

import {
  dateLine,
  firstName,
  formatThousands,
  greeting,
  greetingFor,
  mealTotals,
  mealTotalsA11y,
  mealTotalsLine,
  mealsOfDay,
  structureSummary,
} from '../todayModel';

function meal(overrides: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'n1',
    userId: 'user-me',
    date: '2026-10-27',
    meal: 'lunch',
    description: 'Pasta con atún',
    kcal: 640,
    carbsG: 90,
    proteinG: 32,
    fatG: 14,
    createdAt: '2026-10-27T13:00:00.000Z',
    ...overrides,
  };
}

describe('greeting', () => {
  test('time of day', () => {
    expect(greetingFor(6)).toBe('Buenos días');
    expect(greetingFor(13)).toBe('Buenos días');
    expect(greetingFor(14)).toBe('Buenas tardes');
    expect(greetingFor(20)).toBe('Buenas tardes');
    expect(greetingFor(21)).toBe('Buenas noches');
    expect(greetingFor(2)).toBe('Buenas noches');
  });

  test('uses the first name when known', () => {
    const morning = new Date(2026, 9, 27, 7, 30);
    expect(greeting('Diego Molina', morning)).toBe('Buenos días, Diego');
    expect(greeting('  ', morning)).toBe('Buenos días');
    expect(greeting(null, new Date(2026, 9, 27, 22, 0))).toBe('Buenas noches');
    expect(firstName('Lucía')).toBe('Lucía');
    expect(firstName(undefined)).toBeNull();
  });

  test('date line', () => {
    expect(dateLine('2026-10-27')).toBe('Martes 27 de octubre');
  });
});

describe('meals', () => {
  test('meals of the day in logging order', () => {
    const entries = [
      meal({ id: 'b', createdAt: '2026-10-27T13:00:00.000Z' }),
      meal({ id: 'a', meal: 'breakfast', createdAt: '2026-10-27T07:00:00.000Z' }),
      meal({ id: 'y', date: '2026-10-26' }),
    ];
    expect(mealsOfDay(entries, '2026-10-27').map((e) => e.id)).toEqual(['a', 'b']);
    expect(mealsOfDay(undefined, '2026-10-27')).toEqual([]);
  });

  test('totals ignore unknown values', () => {
    const totals = mealTotals([meal({ kcal: 1200 }), meal({ kcal: 640, carbsG: null }), meal({ kcal: null, proteinG: null })]);
    expect(totals).toEqual({ count: 3, kcal: 1840, carbsG: 180, proteinG: 64 });
    expect(mealTotalsLine(totals)).toBe('1.840 kcal · 180 g HC · 64 g proteína');
    expect(mealTotalsA11y(totals)).toBe('Total de hoy: 1840 kilocalorías, 180 gramos de hidratos, 64 gramos de proteína');
  });

  test('nothing known → empty line', () => {
    const totals = mealTotals([meal({ kcal: null, carbsG: null, proteinG: null })]);
    expect(totals.kcal).toBeNull();
    expect(mealTotalsLine(totals)).toBe('');
    expect(mealTotalsA11y(totals)).toBe('');
    expect(mealTotals([])).toEqual({ count: 0, kcal: null, carbsG: null, proteinG: null });
  });

  test('thousands separator', () => {
    expect(formatThousands(980)).toBe('980');
    expect(formatThousands(12345.6)).toBe('12.346');
  });
});

describe('structureSummary', () => {
  test('first three steps in one line', () => {
    const w = makeWorkout({
      sport: 'run',
      steps: [
        { kind: 'warmup', durationMin: 15 },
        { kind: 'work', durationMin: 4, repeat: 6, intensity: 'threshold' },
        { kind: 'recovery', durationMin: 2, repeat: 6 },
        { kind: 'cooldown', durationMin: 10 },
      ],
    });
    expect(structureSummary(w)).toBe("15' Calentamiento · 6× 4' Trabajo · 6× 2' Recuperación · +1");
  });

  test('null without steps', () => {
    expect(structureSummary(makeWorkout({ steps: [] }))).toBeNull();
  });
});
