import { describe, expect, test } from '@jest/globals';

import type { NutritionLog } from '@/domain/types';

import { makeWorkout } from '../../coach/__tests__/fixtures';
import {
  dayTotals,
  defaultSlot,
  emptyNutritionForm,
  fuelingSessions,
  groupBySlot,
  parseOptionalNumber,
  validateNutritionForm,
} from '../nutritionModel';

const DATE = '2026-10-25';

function log(overrides: Partial<NutritionLog>): NutritionLog {
  return {
    id: 'n1',
    userId: 'me',
    date: DATE,
    meal: 'breakfast',
    description: 'Avena',
    kcal: null,
    carbsG: null,
    proteinG: null,
    fatG: null,
    createdAt: '2026-10-25T07:00:00.000Z',
    ...overrides,
  };
}

describe('nutritionModel', () => {
  test('groups by slot in day order, entries by time', () => {
    const groups = groupBySlot([
      log({ id: 'd', meal: 'dinner' }),
      log({ id: 'b2', meal: 'breakfast', createdAt: '2026-10-25T08:00:00.000Z' }),
      log({ id: 'b1', meal: 'breakfast', createdAt: '2026-10-25T07:00:00.000Z' }),
      log({ id: 'p', meal: 'post' }),
    ]);
    expect(groups.map((g) => g.slot)).toEqual(['breakfast', 'dinner', 'post']);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['b1', 'b2']);
  });

  test('daily totals only flag macros when present', () => {
    expect(dayTotals([log({})]).hasMacros).toBe(false);
    const totals = dayTotals([log({ kcal: 400, carbsG: 60 }), log({ id: 'x', kcal: 250, proteinG: 20 })]);
    expect(totals).toEqual({ kcal: 650, carbsG: 60, proteinG: 20, fatG: 0, hasMacros: true });
  });

  test('default slot by hour', () => {
    expect(defaultSlot(8)).toBe('breakfast');
    expect(defaultSlot(14)).toBe('lunch');
    expect(defaultSlot(18)).toBe('snack');
    expect(defaultSlot(22)).toBe('dinner');
  });

  test('parses optional numbers with decimal comma', () => {
    expect(parseOptionalNumber('')).toBeNull();
    expect(parseOptionalNumber(' 45 ')).toBe(45);
    expect(parseOptionalNumber('12,5')).toBe(12.5);
    expect(parseOptionalNumber('abc')).toBeNaN();
  });

  test('validates the inline form into a draft (macros rounded)', () => {
    const form = { ...emptyNutritionForm('lunch'), description: ' Pasta con atún ', carbsG: '90,6', kcal: '' };
    const result = validateNutritionForm(form, DATE);
    expect(result).toEqual({
      ok: true,
      draft: { date: DATE, meal: 'lunch', description: 'Pasta con atún', kcal: null, carbsG: 91, proteinG: null, fatG: null },
    });
  });

  test('rejects empty descriptions and non-numeric macros', () => {
    expect(validateNutritionForm(emptyNutritionForm('lunch'), DATE)).toEqual({ ok: false, error: 'Describe lo que has comido.' });
    const bad = validateNutritionForm({ ...emptyNutritionForm('lunch'), description: 'Pan', fatG: 'mucho' }, DATE);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('Grasa: escribe un número, por ejemplo 45.');
  });

  test('fueling sessions: key first, then longest; skips rest/mobility/skipped and other days', () => {
    const sessions = fuelingSessions(
      [
        makeWorkout({ id: 'short', date: DATE, durationMin: 40 }),
        makeWorkout({ id: 'long', date: DATE, sport: 'bike', durationMin: 180 }),
        makeWorkout({ id: 'key', date: DATE, durationMin: 60, isKey: true }),
        makeWorkout({ id: 'rest', date: DATE, sport: 'rest', durationMin: 0 }),
        makeWorkout({ id: 'mob', date: DATE, sport: 'mobility', durationMin: 20 }),
        makeWorkout({ id: 'skipped', date: DATE, status: 'skipped', durationMin: 200 }),
        makeWorkout({ id: 'other-day', date: '2026-10-26', durationMin: 240 }),
        makeWorkout({ id: 'extra', date: DATE, durationMin: 30 }),
      ],
      DATE,
    );
    expect(sessions.map((s) => s.id)).toEqual(['key', 'long', 'short']);
  });
});
