import { describe, expect, test } from '@jest/globals';

import { addDays } from '@/domain/dates';
import type { Readiness } from '@/domain/readiness';
import { makeWorkout } from '@/domain/__tests__/fixtures';

import { stressSignal } from '../../stress/__tests__/stressFixtures';
import { adaptNudge, type AdaptNudgeInput } from '../adaptNudge';

const TODAY = '2026-10-28';
const fine: Readiness = { score: 80, level: 'green', factors: [], recommendation: '' };
const tired: Readiness = { score: 48, level: 'amber', factors: ['VFC 14 % bajo tu media'], recommendation: '' };
const tempoToday = makeWorkout({ id: 'tempo', date: TODAY, sport: 'bike', intensity: 'tempo', durationMin: 60, title: 'Bici tempo' });
const easyTomorrow = makeWorkout({ id: 'easy', date: addDays(TODAY, 1), sport: 'run', durationMin: 40, title: 'Rodaje' });
const inThreeDays = makeWorkout({ id: 'later', date: addDays(TODAY, 3), sport: 'run', durationMin: 40, title: 'Rodaje' });

function input(overrides: Partial<AdaptNudgeInput> = {}): AdaptNudgeInput {
  return {
    today: TODAY,
    readiness: fine,
    checkinDone: true,
    workouts: [easyTomorrow],
    pendingProposals: 0,
    dismissed: [],
    stressSleep: stressSignal(TODAY),
    ...overrides,
  };
}

describe('adaptNudge — stress costing sleep', () => {
  test('offers to ease the next days with the figure, even after the check-in', () => {
    expect(adaptNudge(input())).toMatchObject({
      kind: 'stress',
      key: `stress:${TODAY}`,
      title: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual',
      detail: '¿Suavizo hoy y mañana, manteniendo lo clave? Esta noche, acuéstate antes.',
      action: 'Suavizar',
    });
    expect(adaptNudge(input({ stressSleep: stressSignal(TODAY, { easeDays: 3, level: 'high' }) }))?.detail).toContain('los próximos 3 días');
  });

  test('nothing to ease in the window: breathing only (no action)', () => {
    const nudge = adaptNudge(input({ workouts: [inThreeDays] }));
    expect(nudge).toMatchObject({ kind: 'stress', action: null });
    expect(nudge?.detail).toContain('respirar despacio');
  });

  test("today's readiness comes first; a dismissed or pending-proposal day stays quiet", () => {
    expect(adaptNudge(input({ readiness: tired, checkinDone: false, workouts: [tempoToday] }))?.kind).toBe('readiness');
    expect(adaptNudge(input({ dismissed: [`stress:${TODAY}`] }))).toBeNull();
    expect(adaptNudge(input({ pendingProposals: 1 }))).toBeNull();
    expect(adaptNudge(input({ stressSleep: null }))).toBeNull();
  });
});
