import { rulesAnalysis } from '../workoutAnalysis';
import { makeCheckin, makeWorkout } from './fixtures';

const NOW = '2026-10-25T10:00:00.000Z';
const thresholds = { lthr: 170, maxHr: 190, restingHr: 48 };

describe('rulesAnalysis', () => {
  test('planned sessions have no analysis', () => {
    expect(rulesAnalysis({ workout: makeWorkout(), thresholds, raceDistance: null, checkin: null, tomorrow: [], now: NOW })).toBeNull();
  });

  test('an easy session done easy: praise, nothing to fix, tomorrow named', () => {
    const workout = makeWorkout({ status: 'completed', intensity: 'endurance', completed: { durationMin: 50, rpe: 3, feel: 4 } });
    const tomorrow = [makeWorkout({ date: '2026-10-26', title: 'Series 5×1 km', durationMin: 60 })];
    const a = rulesAnalysis({ workout, thresholds, raceDistance: null, checkin: null, tomorrow, now: NOW });
    expect(a).toMatchObject({ engine: 'rules', workoutId: workout.id, improve: [], createdAt: NOW });
    expect(a?.wentWell[0]).toMatch(/RPE 3/);
    expect(a?.nextStep).toBe('Mañana toca «Series 5×1 km» (60\').');
  });

  test('a session harder than planned is explained by the morning journal and asks to recover', () => {
    const workout = makeWorkout({ status: 'completed', intensity: 'endurance', completed: { durationMin: 50, rpe: 8, feel: 2 } });
    const checkin = makeCheckin({ habits: { alcohol: true, niggle: true } });
    const a = rulesAnalysis({ workout, thresholds, raceDistance: null, checkin, tomorrow: [], now: NOW });
    expect(a?.headline).toBe('Más dura de lo previsto');
    expect(a?.improve.join(' ')).toMatch(/alcohol/);
    expect(a?.improve.length).toBeLessThanOrEqual(3);
    expect(a?.nextStep).toMatch(/^Hoy, recupera/);
  });

  test('the watch file: a heart rate that came loose in the second half is something to fix, a steady one is praised', () => {
    const long = (decouplingPct: number) =>
      makeWorkout({
        status: 'completed',
        intensity: 'endurance',
        durationMin: 90,
        completed: { durationMin: 92, rpe: 3, feel: 4, decouplingPct, hrDriftBpm: decouplingPct, analyzedAt: NOW },
      });
    const loose = rulesAnalysis({ workout: long(7), thresholds, raceDistance: null, checkin: null, tomorrow: [], now: NOW });
    expect(loose?.improve[0]).toMatch(/^En la segunda mitad tu pulso subió 7 ppm y rendiste un 7 % menos por latido/);
    const steady = rulesAnalysis({ workout: long(2), thresholds, raceDistance: null, checkin: null, tomorrow: [], now: NOW });
    expect(steady?.improve).toEqual([]);
    expect(steady?.wentWell[1]).toMatch(/^Pulso estable en la segunda mitad \(desacople del 2 %\)/);
  });
});
