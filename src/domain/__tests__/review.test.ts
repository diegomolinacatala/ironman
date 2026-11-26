import { expectedRpe, reviewTrend, reviewWorkout, TREND_DAYS } from '../review';
import { buildSession } from '../sessions';
import type { CompletedData, Thresholds, Workout } from '../types';
import { makeWorkout } from './fixtures';

const T: Thresholds = { lthr: 170, maxHr: 190, runThresholdPaceSecPerKm: 270, ftpW: 250, swimCssSecPer100m: 105 };

function done(w: Partial<Workout>, completed: CompletedData): Workout {
  return makeWorkout({ ...w, status: 'completed', completed: { durationMin: w.durationMin ?? 45, ...completed } });
}

function thresholdRun(completed: CompletedData): Workout {
  const steps = buildSession({ code: 'RN_THR', durationMin: 60, priority: 1 }).steps;
  return done({ sport: 'run', intensity: 'threshold', durationMin: 60, steps, title: "Series umbral 3×8'" }, completed);
}

describe('reviewWorkout', () => {
  test('only completed sessions get a verdict', () => {
    expect(reviewWorkout(makeWorkout(), T)).toBeNull();
    expect(reviewWorkout(makeWorkout({ status: 'skipped' }), T)).toBeNull();
  });

  test('easy run inside the planned HR: on target, with the numbers', () => {
    const r = reviewWorkout(done({}, { avgHr: 148, rpe: 3, feel: 4 }), T);
    expect(r).toEqual(expect.objectContaining({ verdict: 'on_target', title: 'Bien hecho: suave de verdad', next: null }));
    expect(r?.plannedHr).toEqual({ min: 145, max: 151 });
    expect(r?.detail).toBe('FC media 148 ppm, dentro de lo previsto (145–151). RPE 3, como estaba previsto (3–4). Sensaciones: bien.');
  });

  test('easy run done easier is fine; done harder gets a pulse cap for next time', () => {
    expect(reviewWorkout(done({}, { avgHr: 135 }), T)?.verdict).toBe('on_target');
    const harder = reviewWorkout(done({}, { avgHr: 160 }), T);
    expect(harder?.verdict).toBe('harder');
    expect(harder?.detail).toMatch(/FC media 160 ppm, por encima de lo previsto \(145–151\)/);
    expect(harder?.next).toBe('En los días suaves, frena: si pasas de 151 ppm, baja el ritmo.');
  });

  test('quality sessions are judged by the main set RPE, and easier is flagged', () => {
    const w = thresholdRun({ rpe: 7, avgHr: 148 });
    expect(expectedRpe(w)).toEqual({ min: 7, max: 8 });
    expect(reviewWorkout(w, T)).toEqual(expect.objectContaining({ verdict: 'on_target', title: 'Sesión clavada' }));
    const easier = reviewWorkout(thresholdRun({ rpe: 5 }), T);
    expect(easier?.verdict).toBe('easier');
    expect(easier?.next).toMatch(/parte alta del rango/);
  });

  test('a session that hurt asks to recover tomorrow', () => {
    const byRpe = reviewWorkout(done({}, { rpe: 7 }), T);
    expect(byRpe?.verdict).toBe('harder');
    expect(byRpe?.next).toMatch(/^Mañana, prioriza recuperar/);
    const byFeel = reviewWorkout(thresholdRun({ rpe: 7, feel: 1 }), T);
    expect(byFeel?.verdict).toBe('harder');
    expect(byFeel?.detail).toMatch(/Sensaciones: muy mal\./);
    expect(byFeel?.next).toMatch(/^Mañana, prioriza recuperar/);
  });

  test('short and long sessions', () => {
    const short = reviewWorkout(done({ durationMin: 60 }, { durationMin: 40 }), T);
    expect(short?.verdict).toBe('short');
    expect(short?.detail).toMatch(/40' de 60' previstos/);
    expect(reviewWorkout(done({ durationMin: 60 }, { durationMin: 80 }), T)?.verdict).toBe('long');
    expect(reviewWorkout(done({ durationMin: 60 }, { durationMin: 66 }), T)?.verdict).toBe('unknown');
  });

  test('without data it asks for RPE and sensations; decimals use a comma', () => {
    const r = reviewWorkout(done({}, {}), T);
    expect(r).toEqual(expect.objectContaining({ verdict: 'unknown', title: 'Sesión hecha' }));
    expect(r?.detail).toMatch(/anótalos al terminar/);
    expect(reviewWorkout(done({}, { rpe: 3.5 }), T)?.detail).toMatch(/RPE 3,5/);
  });

  test('without thresholds the run HR is shown but not judged', () => {
    const r = reviewWorkout(done({}, { avgHr: 152 }), null);
    expect(r?.plannedHr).toBeNull();
    expect(r).toEqual(expect.objectContaining({ verdict: 'unknown', title: 'Sesión hecha', detail: 'FC media 152 ppm.' }));
    expect(r?.next).toMatch(/anota el RPE y las sensaciones/);
  });

  test('swim has no HR plan; unplanned activities are not judged', () => {
    const swim = reviewWorkout(done({ sport: 'swim' }, { avgHr: 150, rpe: 4 }), T);
    expect(swim?.plannedHr).toBeNull();
    expect(swim?.detail).not.toMatch(/FC media/);
    const imported = reviewWorkout(done({ source: 'garmin', externalId: 'garmin:1' }, { avgHr: 150, rpe: 5 }), T);
    expect(imported).toEqual(expect.objectContaining({ verdict: 'unknown', title: 'Actividad registrada', next: null }));
    expect(imported?.detail).toMatch(/FC media 150 ppm\. RPE 5\./);
  });
});

describe('reviewTrend (easy sessions that keep coming out harder)', () => {
  const TODAY = '2026-10-25';
  /** Easy run (Z2, 45'): planned HR 145–151 ppm and RPE 3–4 with T. */
  const easyRun = (date: string, completed: CompletedData, patch: Partial<Workout> = {}) => done({ date, ...patch }, completed);

  test('3 of the last 4 easy runs above the zone: suggest reviewing the zones', () => {
    const runs = [
      easyRun('2026-10-24', { avgHr: 160 }),
      easyRun('2026-10-22', { avgHr: 148 }),
      easyRun('2026-10-20', { avgHr: 159 }),
      easyRun('2026-10-18', { avgHr: 162 }),
      // Fifth: outside the window of four.
      easyRun('2026-10-16', { avgHr: 147 }),
    ];
    expect(reviewTrend(runs, T, { today: TODAY })).toEqual({
      sport: 'run',
      sessions: 4,
      harder: 3,
      signal: 'hr',
      lastDate: '2026-10-24',
      message: 'Tus rodajes suaves van más duros de lo previsto: ¿revisamos tus zonas?',
      detail: '3 de tus últimos 4 rodajes suaves, con el pulso medio por encima de tu zona.',
      advice: 'Si tu pulso de umbral ha cambiado, actualízalo; si no, frena un poco en los días suaves.',
    });
  });

  test('2 of 4 is not a trend, and an older streak outside the last 4 does not count', () => {
    const runs = [
      easyRun('2026-10-24', { avgHr: 148 }),
      easyRun('2026-10-22', { avgHr: 160 }),
      easyRun('2026-10-20', { avgHr: 147 }),
      easyRun('2026-10-18', { avgHr: 162 }),
      easyRun('2026-10-16', { avgHr: 163 }),
      easyRun('2026-10-14', { avgHr: 164 }),
    ];
    expect(reviewTrend(runs, T, { today: TODAY })).toBeNull();
  });

  test('RPE above the plan counts too, also without thresholds; all of them reads «Tus últimas…»', () => {
    const rides = ['2026-10-24', '2026-10-21', '2026-10-19'].map((date) => done({ date, sport: 'bike', title: 'Bici fondo Z2' }, { rpe: 6 }));
    const trend = reviewTrend(rides, null, { today: TODAY });
    expect(trend).toMatchObject({ sport: 'bike', sessions: 3, harder: 3, signal: 'rpe' });
    expect(trend?.message).toBe('Tus salidas suaves en bici van más duras de lo previsto: ¿revisamos tus zonas?');
    expect(trend?.detail).toBe('Tus últimas 3 salidas suaves en bici, con un esfuerzo (RPE) por encima de lo previsto.');
    expect(trend?.advice).toBe('Si tus umbrales ya no son los de ahora, actualízalos; si no, frena un poco en los días suaves.');
  });

  test('sessions with nothing to compare are skipped: the last 4 with HR or RPE decide', () => {
    const runs = [
      easyRun('2026-10-24', { avgHr: 160 }),
      easyRun('2026-10-23', {}),
      easyRun('2026-10-22', { feel: 2 }),
      easyRun('2026-10-20', { rpe: 6 }),
      easyRun('2026-10-18', { avgHr: 150, rpe: 3 }),
      easyRun('2026-10-16', { avgHr: 161 }),
    ];
    expect(reviewTrend(runs, T, { today: TODAY })).toMatchObject({ sessions: 4, harder: 3, signal: 'both' });
  });

  test('not counted: quality sessions, imports without a plan, sessions older than six weeks, bad sensations alone', () => {
    const hard = [
      easyRun('2026-10-24', { avgHr: 170 }, { intensity: 'threshold', title: 'Series' }),
      easyRun('2026-10-23', { avgHr: 160 }, { source: 'garmin', externalId: 'garmin:9' }),
      easyRun('2026-10-22', { feel: 1, avgHr: 148, rpe: 4 }),
      easyRun('2026-09-01', { avgHr: 165 }),
      easyRun('2026-08-30', { avgHr: 166 }),
      easyRun('2026-10-21', { avgHr: 160 }),
      easyRun('2026-10-19', { avgHr: 161 }),
    ];
    expect(reviewTrend(hard, T, { today: TODAY })).toBeNull();
    expect(TREND_DAYS).toBe(42);
    // Planned sessions and sessions after today are never compared.
    expect(reviewTrend([easyRun('2026-10-26', { avgHr: 160 }), easyRun('2026-10-27', { avgHr: 160 }), easyRun('2026-10-28', { avgHr: 160 })], T, { today: TODAY })).toBeNull();
  });

  test('swim is judged by RPE only (no pulse in the pool); run comes first when two sports trend', () => {
    const swims = ['2026-10-24', '2026-10-22', '2026-10-20'].map((date) => done({ date, sport: 'swim', title: 'Nado técnica' }, { avgHr: 175, rpe: 6 }));
    expect(reviewTrend(swims, T, { today: TODAY })).toMatchObject({ sport: 'swim', signal: 'rpe', detail: 'Tus últimos 3 nados suaves, con un esfuerzo (RPE) por encima de lo previsto.' });
    const runs = ['2026-10-23', '2026-10-21', '2026-10-19'].map((date) => easyRun(date, { avgHr: 160 }));
    expect(reviewTrend([...swims, ...runs], T, { today: TODAY })?.sport).toBe('run');
  });
});
