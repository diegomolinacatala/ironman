import { expectedRpe, reviewWorkout } from '../review';
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
