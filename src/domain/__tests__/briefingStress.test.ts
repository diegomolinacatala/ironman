import { composeBriefing } from '../briefing';
import { STRESS_SLEEP_FOCUS, stressSleepSpoken } from '../briefingStress';
import type { StressSleepSignal } from '../stressSleep';
import { makeMetrics, makeWorkout } from './fixtures';

const DATE = '2026-10-27';
const NOW = new Date(2026, 9, 27, 7, 30);

function signal(overrides: Partial<StressSleepSignal> = {}): StressSleepSignal {
  return {
    date: DATE,
    level: 'moderate',
    exam: false,
    flaggedNights: 2,
    stressDays: 3,
    worse: { kind: 'hours', amount: 60 },
    usualBedtimeMin: 23 * 60,
    easeDays: 2,
    headline: 'Estrés alto 3 días y dormiste 1 h menos de lo habitual',
    advice: 'hoy suave y acuéstate antes',
    message: 'Estrés alto 3 días y dormiste 1 h menos de lo habitual: hoy suave y acuéstate antes.',
    reasons: [],
    nights: [],
    ...overrides,
  };
}

describe('stressSleepSpoken', () => {
  test('said as it is heard, with the figure and the bedtime', () => {
    expect(stressSleepSpoken(signal())).toBe(
      'Llevas tres días con estrés alto y has dormido una hora menos de lo habitual: hoy, suave, y esta noche a la cama sobre las diez y media.',
    );
    expect(stressSleepSpoken(signal({ exam: true, level: 'high', worse: { kind: 'hours', amount: 45 } }))).toBe(
      'Con los exámenes, llevas tres días con estrés alto y has dormido tres cuartos de hora menos de lo habitual: hoy, suave; esta noche, unos minutos de respiración lenta y a la cama sobre las diez y media.',
    );
    expect(stressSleepSpoken(signal({ worse: { kind: 'score', amount: 12 } }))).toContain('tu sueño puntúa doce puntos menos');
    expect(stressSleepSpoken(signal({ stressDays: 2, worse: { kind: 'later', amount: 60 } }))).toMatch(/^Llevas dos días .* te acuestas una hora más tarde/);
  });
});

describe('composeBriefing with the stress-and-sleep signal', () => {
  const base = {
    date: DATE,
    name: 'Diego',
    metrics: [makeMetrics(DATE, { sleepHours: 6.5 })],
    todayWorkouts: [makeWorkout({ id: 'w', date: DATE, sport: 'run', durationMin: 50, intensity: 'threshold', title: 'Series' })],
    tomorrowWorkouts: [],
    race: null,
    now: NOW,
  };

  test('one sentence after the sleep and an easy focus on a training day', () => {
    const b = composeBriefing({ ...base, stressSleep: signal() });
    expect(b.script).toContain('Llevas tres días con estrés alto y has dormido una hora menos de lo habitual');
    expect(b.script.indexOf('estrés alto')).toBeGreaterThan(b.script.indexOf('Has dormido'));
    expect(b.script.indexOf('estrés alto')).toBeLessThan(b.script.indexOf('Hoy toca'));
    expect(b.focus).toBe(STRESS_SLEEP_FOCUS);
  });

  test('nothing about stress without the signal', () => {
    const b = composeBriefing(base);
    expect(b.script).not.toContain('estrés');
    expect(b.focus).not.toBe(STRESS_SLEEP_FOCUS);
  });
});
