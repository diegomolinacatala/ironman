/// <reference types="jest" />
import type { CoachRequest, PlanChange, Workout } from '@/domain/types';
import { makeProfile, makeWorkout } from '@/domain/__tests__/fixtures';

import { chatEdit, dayRefs, sportIn, type EditContext } from '../demo/coachEdits';
import { runRulesCoach, type RulesCoachRepo } from '../demo/rulesCoach';

// 2026-10-27 is a Tuesday: the editable window is Tue 27 → Mon 2.
const TODAY = '2026-10-27';

const WORKOUTS: Workout[] = [
  makeWorkout({ id: 'tue-run', date: '2026-10-27', sport: 'run', title: 'Rodaje Z2', intensity: 'endurance', durationMin: 45 }),
  makeWorkout({ id: 'wed-bike', date: '2026-10-28', sport: 'bike', title: 'Rodillo', intensity: 'endurance', durationMin: 60 }),
  makeWorkout({ id: 'wed-swim', date: '2026-10-28', sport: 'swim', title: 'Técnica', intensity: 'recovery', durationMin: 40 }),
  makeWorkout({ id: 'thu-series', date: '2026-10-29', sport: 'run', title: 'Series 5×4', intensity: 'vo2', durationMin: 60, isKey: true }),
  makeWorkout({ id: 'sat-long', date: '2026-10-31', sport: 'run', title: 'Tirada larga', intensity: 'endurance', durationMin: 90, isKey: true }),
  makeWorkout({ id: 'mon-done', date: '2026-10-26', sport: 'swim', title: 'Hecho', status: 'completed' }),
];

const profile = makeProfile({ availability: { weeklyHoursTarget: 9, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] } });

const ctx = (workouts: Workout[] = WORKOUTS): EditContext => ({
  today: TODAY,
  workouts,
  replanInput: { today: TODAY, weekWorkouts: workouts, profile, busyBlocks: [], lifeEvents: [], jointSessions: [], races: [] },
});

const ops = (changes: readonly PlanChange[]): string[] =>
  changes.map((c) => (c.op === 'add' ? `add:${c.workout.date}` : c.op === 'move' ? `move:${c.workoutId}:${c.toDate}` : `${c.op}:${c.workoutId}`));

describe('rules coach chat edits', () => {
  test('days resolve inside the 7-day window; "por la mañana" is not tomorrow', () => {
    expect(dayRefs('del martes al jueves', TODAY).map((r) => [r.date, r.source, r.destination])).toEqual([
      ['2026-10-27', true, false],
      ['2026-10-29', false, true],
    ]);
    expect(dayRefs('el lunes por la mañana', TODAY).map((r) => r.date)).toEqual(['2026-11-02']);
    expect(dayRefs('pasado mañana', TODAY).map((r) => r.date)).toEqual(['2026-10-29']);
    expect(sportIn('el rodaje en bici')).toBe('bike');
    expect(sportIn('la natación')).toBe('swim');
  });

  test('"mueve el rodaje del martes al jueves" → move, warning about the session already there', () => {
    const edit = chatEdit('Mueve el rodaje del martes al jueves', ctx());
    expect(ops(edit?.changes ?? [])).toEqual(['move:tue-run:2026-10-29']);
    expect(edit?.summary).toMatch(/Ojo: el jue 29 oct ya tienes «Series 5×4»/);
  });

  test('"pasa las series al sábado" finds the session by its title', () => {
    expect(ops(chatEdit('pasa las series al sábado', ctx())?.changes ?? [])).toEqual(['move:thu-series:2026-10-31']);
  });

  test('"quita…" deletes one clear session; an ambiguous one is explained, not guessed', () => {
    expect(ops(chatEdit('Quita la natación de mañana', ctx())?.changes ?? [])).toEqual(['delete:wed-swim']);
    const ambiguous = chatEdit('Quita el entreno de mañana', ctx());
    expect(ambiguous?.changes).toEqual([]);
    expect(ambiguous?.summary).toMatch(/No encuentro ese entreno mañana/);
    expect(chatEdit('borra la tirada', ctx())?.summary).toMatch(/sesión clave/);
  });

  test('"cambia las series del jueves por un rodaje suave" → easy session, no longer key', () => {
    const edit = chatEdit('Cambia las series del jueves por un rodaje suave de 40 min', ctx());
    const change = edit?.changes[0];
    expect(change?.op).toBe('update');
    if (change?.op !== 'update') return;
    expect(change.workoutId).toBe('thu-series');
    expect(change.patch).toMatchObject({ intensity: 'endurance', durationMin: 40, isKey: false });
    expect(change.patch.title).toBeTruthy();
  });

  test('"hoy no puedo" drops today\'s easy session; a key day is re-placed', () => {
    expect(ops(chatEdit('Hoy no puedo entrenar', ctx())?.changes ?? [])).toEqual(['delete:tue-run']);
    const thursday = chatEdit('El jueves no puedo', ctx());
    expect(thursday?.changes.some((c) => c.op !== 'add' && c.workoutId === 'thu-series')).toBe(true);
    expect(chatEdit('Mañana no puedo', ctx([]))?.summary).toMatch(/No tienes nada planificado mañana/);
  });

  test('"tengo pádel el jueves a las 19" re-plans around the match', () => {
    const edit = chatEdit('Tengo pádel el jueves a las 19', ctx());
    expect(edit).not.toBeNull();
    expect(edit?.summary).toMatch(/Apúntalo también como imprevisto/);
    expect(edit?.changes.every((c) => c.op === 'add' || WORKOUTS.some((w) => w.id === c.workoutId))).toBe(true);
  });

  test('questions and injuries are not edits', () => {
    expect(chatEdit('¿Qué toca hoy?', ctx())).toBeNull();
    expect(chatEdit('Me duele la rodilla y hoy no puedo correr', ctx(), { injury: true })).toBeNull();
    expect(chatEdit('', ctx())).toBeNull();
  });
});

describe('runRulesCoach with a chat edit', () => {
  function repo(): RulesCoachRepo & { created: unknown[] } {
    const created: unknown[] = [];
    return {
      created,
      getMyProfile: async () => profile,
      listRaces: async () => [],
      listWorkouts: async (range) => WORKOUTS.filter((w) => w.date >= range.from && w.date <= range.to),
      listLifeEvents: async () => [],
      listBusyBlocks: async () => [],
      listJointSessions: async () => [],
      listCheckins: async () => [],
      listMetrics: async () => [],
      listWeekPlans: async () => [],
      createProposal: async (draft) => {
        created.push(draft);
        return { ...draft, id: 'p1', userId: 'me', status: 'pending', model: null, createdAt: '2026-10-27T10:00:00' };
      },
    };
  }

  test('the fallback turns "mueve…" into a rules proposal, with the AI notice first', async () => {
    const r = repo();
    const request: CoachRequest = { mode: 'chat', weekStart: '2026-10-26', message: 'Mueve el rodaje del martes al jueves' };
    const response = await runRulesCoach(r, request, { today: TODAY, notice: 'La IA gratuita ha llegado a su límite de hoy.' });
    expect(response.engine).toBe('rules');
    expect(response.proposal?.changes).toEqual([expect.objectContaining({ op: 'move', workoutId: 'tue-run', toDate: '2026-10-29' })]);
    expect(response.reply).toMatch(/^La IA gratuita ha llegado a su límite de hoy\.\n\nPaso «Rodaje Z2»/);
    expect(response.reply).toMatch(/Te he preparado 1 cambio/);
    expect(r.created).toHaveLength(1);
  });
});
