import { describe, expect, test } from '@jest/globals';

import type { WeekSummary } from '@/domain/load';
import { makeWorkout } from '@/features/workouts/__tests__/fixtures';

import { dayDurationLabel, daySessionsLine, dayState, weekSummaryLine } from '../daySummary';

const summary: WeekSummary = {
  plannedMin: 588,
  completedMin: 456,
  plannedTss: 0,
  completedTss: 0,
  sessions: 8,
  completedSessions: 6,
  compliancePct: 0.98,
  bySport: {},
};

describe('folded day', () => {
  test('lists session titles, or says it is free', () => {
    const w = [makeWorkout({ id: 'a', title: 'Natación fondo' }), makeWorkout({ id: 'b', title: 'Carrera tempo' })];
    expect(daySessionsLine(w, false)).toBe('Natación fondo · Carrera tempo');
    expect(daySessionsLine([], false)).toBe('Libre');
    expect(daySessionsLine([], true)).toBe('Sin sesiones');
    expect(daySessionsLine([makeWorkout({ id: 'r', sport: 'rest', title: 'Descanso' })], false)).toBe('Descanso');
  });

  test('total planned time of the day', () => {
    expect(dayDurationLabel([makeWorkout({ id: 'a', durationMin: 60 }), makeWorkout({ id: 'b', durationMin: 55 })])).toBe("1h 55'");
    expect(dayDurationLabel([])).toBeNull();
  });

  test('done, missed, partial and planned days', () => {
    const done = makeWorkout({ id: 'a', status: 'completed' });
    const planned = makeWorkout({ id: 'b', status: 'planned' });
    expect(dayState([done], '2026-11-10', '2026-11-12')).toBe('done');
    expect(dayState([planned], '2026-11-10', '2026-11-12')).toBe('missed');
    expect(dayState([done, planned], '2026-11-10', '2026-11-12')).toBe('partial');
    expect(dayState([planned], '2026-11-13', '2026-11-12')).toBe('planned');
    expect(dayState([], '2026-11-13', '2026-11-12')).toBe('empty');
    const skipped = makeWorkout({ id: 's', status: 'skipped' });
    expect(dayState([skipped], '2026-11-10', '2026-11-12')).toBe('adjusted');
    expect(dayState([skipped, done], '2026-11-10', '2026-11-12')).toBe('done');
  });
});

describe('folded week summary', () => {
  test('hours done of planned and compliance', () => {
    expect(weekSummaryLine(summary)).toBe('7,6 de 9,8 h · 98 % cumplido');
    expect(weekSummaryLine({ ...summary, compliancePct: null })).toBe('7,6 de 9,8 h · 8 sesiones');
    expect(weekSummaryLine({ ...summary, compliancePct: null, sessions: 0 })).toBe('Semana en blanco');
  });
});
