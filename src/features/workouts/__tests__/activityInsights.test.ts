import { activityInsights } from '../activityInsights';
import { makeWorkout } from './fixtures';

const done = (sport: 'run' | 'bike', completed: NonNullable<Parameters<typeof makeWorkout>[0]>['completed'], durationMin = 90) =>
  makeWorkout({ sport, durationMin, status: 'completed', completed: { source: 'garmin', externalId: '1', durationMin, ...completed } });

describe('activityInsights', () => {
  test('heart rate that rose in the second half, in ppm and %', () => {
    expect(activityInsights(done('run', { decouplingPct: 6.4, hrDriftBpm: 8.2 }))).toEqual([
      'En la segunda mitad tu pulso subió 8 ppm y rendiste un 6 % menos por latido. Suele ser calor, poca hidratación o falta de base aeróbica.',
    ]);
    expect(activityInsights(done('run', { decouplingPct: 7, hrDriftBpm: 0.5 }))[0]).toMatch(/^En la segunda mitad rendiste un 7 % menos por latido/);
  });

  test('a steady or a negative decoupling', () => {
    expect(activityInsights(done('run', { decouplingPct: 2.2, hrDriftBpm: 1 }))).toEqual([
      'Pulso estable en la segunda mitad (desacople del 2 %): buena señal de base aeróbica.',
    ]);
    expect(activityInsights(done('run', { decouplingPct: -6 }))[0]).toMatch(/^Terminaste más eficiente.*un 6 % más por latido/);
  });

  test('quiet on short sessions, other sports and planned ones', () => {
    expect(activityInsights(done('run', { decouplingPct: 9 }, 40))).toEqual([]);
    expect(activityInsights(makeWorkout({ sport: 'swim', status: 'completed', durationMin: 60, completed: { decouplingPct: 9 } }))).toEqual([]);
    expect(activityInsights(makeWorkout({ completed: { decouplingPct: 9 } }))).toEqual([]);
    expect(activityInsights(done('run', {}))).toEqual([]);
  });

  test('rides: normalized power, IF and the power curve from the file', () => {
    const ride = done('bike', {
      decouplingPct: 3,
      normalizedPowerW: 212,
      intensityFactor: 0.85,
      bestPower1MinW: 320,
      bestPower5MinW: 270,
      bestPower20MinW: 235,
      analyzedAt: '2026-11-28T10:00:00Z',
    });
    expect(activityInsights(ride)).toEqual([
      'Pulso estable en la segunda mitad (desacople del 3 %): buena señal de base aeróbica.',
      'Potencia normalizada 212 W · IF 0,85.',
      'Mejor potencia: 1 min 320 W · 5 min 270 W · 20 min 235 W.',
    ]);
    expect(activityInsights(done('bike', { bestPower1MinW: 320, bestPower20MinW: 235 }))).toEqual([]);
  });
});
