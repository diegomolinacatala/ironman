import { describe, expect, test } from '@jest/globals';

import type { Readiness } from '@/domain/readiness';
import type { Workout } from '@/domain/types';
import type { PrescriptionContext } from '@/features/coach/prescriptionContext';
import { makeWorkout } from '@/features/coach/__tests__/fixtures';

import { todayAdvice, todaySession } from '../todayAdvice';

const DATE = '2026-10-27';
const CTX: PrescriptionContext = { thresholds: { lthr: 170, ftpW: 250 }, raceDistance: null };
const NO_THRESHOLDS: PrescriptionContext = { thresholds: null, raceDistance: null };

function readiness(level: Readiness['level']): Readiness {
  return { score: level === 'unknown' ? null : 50, level, factors: [], recommendation: '' };
}

function session(overrides: Partial<Workout>): Workout {
  return makeWorkout({ date: DATE, status: 'planned', ...overrides });
}

const SERIES = session({ id: 'series', title: "Series 3×8'", intensity: 'threshold', durationMin: 55 });
const EASY = session({ id: 'easy', title: 'Rodaje suave', intensity: 'endurance', durationMin: 45 });
const LONG = session({ id: 'long', title: 'Tirada larga', intensity: 'endurance', durationMin: 90 });

describe('todaySession', () => {
  test("picks today's most demanding session still to do", () => {
    const workouts = [
      EASY,
      SERIES,
      session({ id: 'done', intensity: 'vo2', status: 'completed' }),
      session({ id: 'skipped', intensity: 'vo2', status: 'skipped' }),
      session({ id: 'rest', sport: 'rest', title: 'Descanso' }),
      session({ id: 'tomorrow', intensity: 'vo2', date: '2026-10-28' }),
    ];
    expect(todaySession(workouts, DATE)?.id).toBe('series');
    expect(todaySession([EASY, LONG], DATE)?.id).toBe('long');
    expect(todaySession([session({ id: 'rest', sport: 'rest' })], DATE)).toBeNull();
  });
});

describe('todayAdvice', () => {
  test("green: names the session with its main target and says go ahead", () => {
    expect(todayAdvice(readiness('green'), [SERIES], DATE, CTX)).toEqual({
      session: { id: 'series', sport: 'run', title: "Series 3×8'", detail: "Carrera · 55' · Z4 · 162–168 ppm" },
      message: 'Adelante: hazla tal como está planteada.',
      alternative: null,
      canAdjust: false,
    });
  });

  test('amber + quality: no forcing, the easier version (×0.7 in Z2) and "Ajustar hoy"', () => {
    const advice = todayAdvice(readiness('amber'), [SERIES], DATE, CTX);
    expect(advice.message).toBe('Puedes hacerla, pero sin forzar: si al calentar no te encuentras bien, pasa a la versión suave.');
    expect(advice.alternative).toBe("Versión suave: 40' en Z2 · 145–151 ppm.");
    expect(advice.canAdjust).toBe(true);
  });

  test('amber + long: shorter (×0.8) in Z2; amber + easy: calm, nothing to adjust', () => {
    const long = todayAdvice(readiness('amber'), [LONG], DATE, CTX);
    expect(long.message).toBe('Hoy vas algo justo: acórtala y quédate en Z1–Z2.');
    expect(long.alternative).toBe("Versión suave: 1h 10' en Z2 · 145–151 ppm.");
    expect(long.canAdjust).toBe(true);

    const easy = todayAdvice(readiness('amber'), [EASY], DATE, CTX);
    expect(easy.message).toBe('Hazla con calma, en la parte baja de la zona.');
    expect(easy.alternative).toBeNull();
    expect(easy.canAdjust).toBe(false);
  });

  test("red: at most 45' very easy in Z1, never longer than the session; other sports, mobility", () => {
    const red = todayAdvice(readiness('red'), [SERIES], DATE, CTX);
    expect(red.message).toBe('Hoy no toca hacerla así: tu cuerpo pide recuperar.');
    expect(red.alternative).toBe("Como mucho: 45' muy suaves en Z1 · 128–143 ppm, o descansa.");
    expect(red.canAdjust).toBe(true);

    const short = session({ id: 'short', intensity: 'vo2', durationMin: 15 });
    expect(todayAdvice(readiness('red'), [short], DATE, CTX).alternative).toBe("Como mucho: 15' muy suaves en Z1 · 128–143 ppm, o descansa.");

    const strength = session({ id: 'gym', sport: 'strength', title: 'Fuerza', intensity: 'tempo', durationMin: 45 });
    const gym = todayAdvice(readiness('red'), [strength], DATE, CTX);
    expect(gym.session?.detail).toBe("Fuerza · 45' · RPE 6–7");
    expect(gym.alternative).toBe('Como mucho, movilidad suave o descanso.');
  });

  test('a brick gets the bike as its easier version; without thresholds, zone and RPE', () => {
    const brick = session({ id: 'brick', sport: 'brick', title: 'Transición', intensity: 'tempo', durationMin: 90 });
    expect(todayAdvice(readiness('amber'), [brick], DATE, CTX).alternative).toBe("Versión suave: 1h 5' en Z2 · 140–185 W.");
    expect(todayAdvice(readiness('amber'), [SERIES], DATE, NO_THRESHOLDS).alternative).toBe("Versión suave: 40' en Z2 · RPE 3–4.");
    expect(todayAdvice(readiness('green'), [SERIES], DATE, NO_THRESHOLDS).session?.detail).toBe("Carrera · 55' · Z4 · RPE 7–8");
  });

  test("the coach's plan B wins over the computed version", () => {
    const withPlanB = { ...SERIES, coaching: { objective: 'Umbral', keys: [], success: 'En zona', planB: "40' suaves en Z2." } };
    expect(todayAdvice(readiness('red'), [withPlanB], DATE, CTX).alternative).toBe("Si no es tu día: 40' suaves en Z2.");
  });

  test('nothing left today: no session, a short line and nothing to adjust', () => {
    expect(todayAdvice(readiness('red'), [], DATE, CTX)).toEqual({
      session: null,
      message: 'Hoy no tienes ningún entreno pendiente: aprovecha para recuperar.',
      alternative: null,
      canAdjust: false,
    });
    expect(todayAdvice(readiness('green'), [session({ status: 'completed' })], DATE, CTX).message).toBe(
      'Hoy no tienes ningún entreno pendiente.',
    );
  });

  test('workouts still unknown: no session named, "Ajustar hoy" stays available on amber and red', () => {
    expect(todayAdvice(readiness('amber'), undefined, DATE, CTX)).toEqual({ session: null, message: null, alternative: null, canAdjust: true });
    expect(todayAdvice(readiness('green'), undefined, DATE, CTX).canAdjust).toBe(false);
  });

  test('unknown readiness: the session without advice', () => {
    const advice = todayAdvice(readiness('unknown'), [SERIES], DATE, CTX);
    expect(advice.session?.title).toBe("Series 3×8'");
    expect(advice.message).toBeNull();
    expect(advice.canAdjust).toBe(false);
  });
});
