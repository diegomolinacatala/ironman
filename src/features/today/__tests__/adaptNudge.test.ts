import { describe, expect, test } from '@jest/globals';

import type { Readiness } from '@/domain/readiness';
import { makeWorkout } from '@/domain/__tests__/fixtures';

import { adaptNudge, type AdaptNudgeInput } from '../adaptNudge';

const TODAY = '2026-10-28';
const tired: Readiness = { score: 48, level: 'amber', factors: ['VFC 14 % bajo tu media'], recommendation: '' };
const exhausted: Readiness = { score: 22, level: 'red', factors: ['Has dormido 4 h'], recommendation: '' };
const fine: Readiness = { score: 80, level: 'green', factors: [], recommendation: '' };

const tempoToday = makeWorkout({ id: 'tempo', date: TODAY, sport: 'bike', intensity: 'tempo', durationMin: 60, title: 'Bici tempo 2×10' });
const easyToday = makeWorkout({ id: 'easy', date: TODAY, sport: 'run', intensity: 'endurance', durationMin: 30, title: 'Rodaje suave' });
const missedLong = makeWorkout({ id: 'long', date: '2026-10-27', sport: 'bike', intensity: 'endurance', durationMin: 150, title: 'Bici larga', isKey: true });
const missedEasy = makeWorkout({ id: 'old-easy', date: '2026-10-27', sport: 'swim', intensity: 'endurance', durationMin: 30, title: 'Natación suave' });

function input(overrides: Partial<AdaptNudgeInput> = {}): AdaptNudgeInput {
  return { today: TODAY, readiness: tired, checkinDone: false, workouts: [tempoToday], pendingProposals: 0, dismissed: [], ...overrides };
}

describe('adaptNudge', () => {
  test('tired by the watch, no check-in and a hard session today: offer to adapt it', () => {
    expect(adaptNudge(input())).toMatchObject({
      kind: 'readiness',
      level: 'amber',
      title: 'Hoy vas algo justo',
      detail: 'VFC 14 % bajo tu media. ¿Adapto «Bici tempo 2×10» para que hoy sume sin hundirte?',
      action: 'Adaptar hoy',
    });
    expect(adaptNudge(input({ readiness: exhausted }))).toMatchObject({ level: 'red', title: 'Hoy tu cuerpo pide recuperar' });
  });

  test('quiet when fine, after a check-in (it offers its own), or with only easy sessions', () => {
    expect(adaptNudge(input({ readiness: fine }))).toBeNull();
    expect(adaptNudge(input({ checkinDone: true }))).toBeNull();
    expect(adaptNudge(input({ workouts: [easyToday] }))).toBeNull();
    expect(adaptNudge(input({ readiness: null }))).toBeNull();
  });

  test('a key session missed in the last two days: offer to place it again; easy ones are not chased', () => {
    const nudge = adaptNudge(input({ readiness: fine, workouts: [missedLong, missedEasy, easyToday] }));
    expect(nudge).toMatchObject({ kind: 'missed', title: 'Te saltaste «Bici larga» (ayer)', action: 'Recolocar' });
    expect(nudge?.kind === 'missed' ? nudge.workouts.map((w) => w.id) : []).toEqual(['long']);
    expect(adaptNudge(input({ readiness: fine, workouts: [missedEasy] }))).toBeNull();
    const done = { ...missedLong, status: 'completed' as const };
    expect(adaptNudge(input({ readiness: fine, workouts: [done] }))).toBeNull();
  });

  test('never on top of a waiting proposal, and "Ahora no" hides it for the day', () => {
    expect(adaptNudge(input({ pendingProposals: 1 }))).toBeNull();
    expect(adaptNudge(input({ dismissed: [`readiness:${TODAY}`] }))).toBeNull();
    // A dismissed readiness offer leaves room for the missed session.
    expect(adaptNudge(input({ workouts: [tempoToday, missedLong], dismissed: [`readiness:${TODAY}`] }))?.kind).toBe('missed');
  });
});
