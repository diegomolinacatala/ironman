/// <reference types="jest" />
import type { PlanChange, Workout } from '@/domain/types';
import { makeProfile, makeWorkout } from '@/domain/__tests__/fixtures';

import { chatEdit, type EditContext } from '../demo/coachEdits';
import { rangeIn, timeOfDay } from '../demo/coachWords';

// 2026-10-27 is a Tuesday: the editable window is Tue 27 → Mon 2.
const TODAY = '2026-10-27';

const WORKOUTS: Workout[] = [
  makeWorkout({ id: 'tue-tempo', date: '2026-10-27', sport: 'bike', title: 'Bici tempo 2×10', intensity: 'tempo', durationMin: 60, startTime: '19:00' }),
  makeWorkout({ id: 'tue-str', date: '2026-10-27', sport: 'strength', title: 'Fuerza', intensity: 'endurance', durationMin: 30, startTime: '07:00' }),
  makeWorkout({ id: 'wed-swim', date: '2026-10-28', sport: 'swim', title: 'Natación técnica', intensity: 'endurance', durationMin: 40 }),
  makeWorkout({ id: 'wed-run', date: '2026-10-28', sport: 'run', title: 'Rodaje suave', intensity: 'endurance', durationMin: 40, startTime: '07:00' }),
  makeWorkout({ id: 'thu-series', date: '2026-10-29', sport: 'run', title: 'Series 5×4', intensity: 'vo2', durationMin: 60, isKey: true }),
  makeWorkout({ id: 'fri-swim', date: '2026-10-30', sport: 'swim', title: 'Natación fondo', intensity: 'endurance', durationMin: 45 }),
  makeWorkout({ id: 'fri-run', date: '2026-10-30', sport: 'run', title: 'Rodaje suave', intensity: 'endurance', durationMin: 35 }),
  makeWorkout({ id: 'sat-long', date: '2026-10-31', sport: 'bike', title: 'Bici larga', intensity: 'endurance', durationMin: 150, isKey: true }),
  makeWorkout({ id: 'sun-run', date: '2026-11-01', sport: 'run', title: 'Tirada larga', intensity: 'endurance', durationMin: 80 }),
  makeWorkout({ id: 'sun-swim', date: '2026-11-01', sport: 'swim', title: 'Natación suave', intensity: 'endurance', durationMin: 30 }),
];

const profile = makeProfile({ availability: { weeklyHoursTarget: 9, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] } });

function ctx(workouts: Workout[] = WORKOUTS, today = TODAY): EditContext {
  return {
    today,
    workouts,
    replanInput: { today, weekWorkouts: workouts, profile, busyBlocks: [], lifeEvents: [], jointSessions: [], races: [] },
  };
}

const ops = (changes: readonly PlanChange[]): string[] =>
  changes.map((c) => (c.op === 'add' ? `add:${c.workout.date}` : c.op === 'move' ? `move:${c.workoutId}:${c.toDate}` : `${c.op}:${c.workoutId}`));

function patchOf(changes: readonly PlanChange[], id: string) {
  const c = changes.find((x) => x.op === 'update' && x.workoutId === id);
  return c?.op === 'update' ? c.patch : undefined;
}

describe('coach words', () => {
  test('ranges: "del jueves al domingo", "hasta el viernes", "esta semana", one day', () => {
    expect(rangeIn('estoy de viaje del jueves al domingo', TODAY)).toEqual({ from: '2026-10-29', to: '2026-11-01' });
    expect(rangeIn('hasta el viernes', TODAY)).toEqual({ from: TODAY, to: '2026-10-30' });
    expect(rangeIn('esta semana', TODAY)).toEqual({ from: TODAY, to: '2026-11-01' });
    expect(rangeIn('el sábado', TODAY)).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(rangeIn('nada de días', TODAY)).toBeNull();
  });

  test('times of day', () => {
    expect(timeOfDay('el jueves por la mañana')).toBe('07:30');
    expect(timeOfDay('a las 7 de la tarde')).toBe('19:00');
    expect(timeOfDay('por la noche')).toBe('20:30');
    expect(timeOfDay('el jueves')).toBeNull();
  });
});

describe('moves said naturally', () => {
  test('"pasa la bici del sábado al domingo" goes to the Sunday after, not back to this week', () => {
    const edit = chatEdit('Va a llover el sábado, pasa la bici al domingo', ctx(WORKOUTS, '2026-10-25'));
    expect(ops(edit?.changes ?? [])).toEqual(['move:sat-long:2026-11-01']);
  });

  test('"pon la natación el jueves por la mañana" picks the next swim and sets the time', () => {
    const edit = chatEdit('Pon la natación el jueves por la mañana', ctx());
    expect(edit?.changes).toEqual([expect.objectContaining({ op: 'move', workoutId: 'wed-swim', toDate: '2026-10-29', toStartTime: '07:30' })]);
  });
});

describe('situations the athlete tells', () => {
  test('"mañana tengo una cena a las 20:00": the evening session moves out of its way, the plan is logged', () => {
    const evening = makeWorkout({ id: 'wed-eve', date: '2026-10-28', sport: 'run', title: 'Rodaje suave', intensity: 'endurance', durationMin: 40, startTime: '20:00' });
    const edit = chatEdit('Mañana tengo una cena a las 20:00', ctx([...WORKOUTS.filter((w) => w.id !== 'wed-run'), evening]));
    expect(edit?.logEvent).toMatchObject({ kind: 'social', title: 'Cena', startDate: '2026-10-28', startTime: '20:00' });
    expect(ops(edit?.changes ?? []).some((o) => o.includes('wed-eve'))).toBe(true);
  });

  test('a dinner on a day without training needs nothing', () => {
    const edit = chatEdit('El lunes tengo una cena', ctx());
    expect(edit?.changes).toEqual([]);
    expect(edit?.summary).toBe('El lun 2 nov no tienes entreno: disfruta de la cena.');
  });

  test('"esta semana tengo exámenes": a lighter week and the exams logged', () => {
    const edit = chatEdit('Esta semana tengo exámenes', ctx());
    expect(edit?.logEvent).toMatchObject({ kind: 'exam', title: 'Exámenes', startDate: TODAY, endDate: '2026-11-01', severity: 2 });
    expect(edit?.changes.length).toBeGreaterThan(0);
    expect(edit?.summary).toMatch(/exámenes/i);
  });

  test('a single exam takes the day before too', () => {
    const edit = chatEdit('Tengo un examen el viernes', ctx());
    expect(edit?.logEvent).toMatchObject({ kind: 'exam', title: 'Examen', startDate: '2026-10-29', endDate: '2026-10-30' });
  });

  test('a trip with dates: logged, with bike or pool only when said', () => {
    const noBike = chatEdit('Estoy de viaje del jueves al domingo sin bici', ctx());
    expect(noBike?.logEvent).toMatchObject({ kind: 'travel', startDate: '2026-10-29', endDate: '2026-11-01', notes: null });
    expect(ops(noBike?.changes ?? [])).toContain('update:sat-long');
    const withBike = chatEdit('Me voy de viaje del jueves al domingo con la bici', ctx());
    expect(withBike?.logEvent?.notes).toBe('Con bici.');
    expect(chatEdit('Me voy de viaje', ctx())?.summary).toMatch(/Qué días estás fuera/);
  });

  test('"no tengo piscina esta semana": swims become dry-land strength', () => {
    const edit = chatEdit('No tengo piscina esta semana', ctx());
    expect(ops(edit?.changes ?? [])).toEqual(['update:wed-swim', 'update:fri-swim', 'update:sun-swim']);
    expect(patchOf(edit?.changes ?? [], 'wed-swim')).toMatchObject({ sport: 'strength', title: 'Fuerza en seco para nadar', durationMin: 30 });
  });

  test('"hoy solo tengo 30 minutos": the key session shrinks, the rest of the day goes', () => {
    const edit = chatEdit('Hoy solo tengo 30 minutos', ctx());
    expect(ops(edit?.changes ?? [])).toEqual(['update:tue-tempo', 'delete:tue-str']);
    expect(patchOf(edit?.changes ?? [], 'tue-tempo')?.durationMin).toBe(30);
    expect(chatEdit('Hoy solo tengo una hora y media', ctx())?.summary).toMatch(/^Te cabe/);
  });
});

describe('what the athlete asks for', () => {
  test('"hazme la semana más suave": no intensity, long sessions 20 % shorter, the rest untouched', () => {
    const changes = chatEdit('Hazme la semana más suave', ctx())?.changes ?? [];
    expect(patchOf(changes, 'thu-series')).toMatchObject({ intensity: 'endurance', durationMin: 50 });
    expect(patchOf(changes, 'tue-tempo')).toMatchObject({ intensity: 'endurance' });
    expect(patchOf(changes, 'sat-long')?.durationMin).toBe(120);
    expect(patchOf(changes, 'wed-swim')).toBeUndefined();
  });

  test('"quiero más bici esta semana": one easy run becomes an easy ride (×1.3); swims untouched', () => {
    const edit = chatEdit('Quiero hacer más bici esta semana', ctx());
    expect(ops(edit?.changes ?? [])).toEqual(['update:wed-run']);
    expect(patchOf(edit?.changes ?? [], 'wed-run')).toMatchObject({ sport: 'bike', durationMin: 50 });
  });

  test('"menos carrera": the last easy run (not the long one) becomes a ride', () => {
    const edit = chatEdit('Quiero menos carrera', ctx());
    expect(ops(edit?.changes ?? [])).toEqual(['update:fri-run']);
    expect(patchOf(edit?.changes ?? [], 'fri-run')?.sport).toBe('bike');
  });

  test('"estoy muy cansado": today\'s quality session is eased or moved', () => {
    const edit = chatEdit('Estoy muy cansado', ctx());
    expect(edit?.changes.some((c) => c.op !== 'add' && c.workoutId === 'tue-tempo')).toBe(true);
    expect(edit?.summary).toMatch(/^Vale, hoy vamos suave/);
  });

  test('a question about exams is not an exam', () => {
    expect(chatEdit('¿Cómo afectan los exámenes al rendimiento?', ctx())).toBeNull();
  });
});
