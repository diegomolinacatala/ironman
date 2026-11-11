import { prescriptionText, sessionFeel, stepLines, targetSummary } from '../prescription';
import type { Thresholds, WorkoutStep } from '../types';

const T: Thresholds = { lthr: 170, maxHr: 190, ftpW: 250, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 100 };

const RUN_INTERVALS = {
  sport: 'run' as const,
  intensity: 'threshold' as const,
  steps: [
    { kind: 'warmup', durationMin: 15, intensity: 'recovery', cue: 'Empieza muy suave y acaba con 3 aceleraciones.' },
    { kind: 'work', durationMin: 8, intensity: 'threshold', repeat: 3 },
    { kind: 'recovery', durationMin: 3, intensity: 'recovery', repeat: 3 },
    { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
  ] as WorkoutStep[],
};

describe('stepLines', () => {
  test('one line per step with zone, targets and sensations', () => {
    const lines = stepLines(RUN_INTERVALS, T);
    expect(lines.map((l) => l.amount)).toEqual(["15'", "3×8'", "3×3'", "10'"]);
    expect(lines.map((l) => l.label)).toEqual(['Calentamiento', 'Series', 'Recuperación', 'Vuelta a la calma']);
    expect(lines[1]!.zone).toBe('Z4');
    expect(lines[1]!.targets).toEqual(['162–168 ppm', '4:27–4:44 /km', 'RPE 7–8']);
    expect(lines[1]!.cue).toMatch(/palabras sueltas/);
    expect(lines[0]!.cue).toBe('Empieza muy suave y acaba con 3 aceleraciones.');
    expect(lines[2]!.cue).toBeNull();
  });

  test('brick legs and strength without zones', () => {
    const brick = stepLines(
      { sport: 'brick', intensity: 'endurance', steps: [{ kind: 'work', durationMin: 60, leg: 'bike' }, { kind: 'work', durationMin: 15, leg: 'run' }] },
      T,
    );
    expect(brick.map((l) => l.label)).toEqual(['Parte principal · bici', 'Parte principal · carrera']);
    expect(brick[0]!.targets[0]).toBe('140–185 W');
    expect(brick[1]!.targets[0]).toBe('145–151 ppm');
    const strength = stepLines({ sport: 'strength', intensity: 'tempo', steps: [{ kind: 'work', durationMin: 30 }] }, T);
    expect(strength[0]!.zone).toBe('');
    expect(strength[0]!.targets).toEqual(['RPE 6–7']);
  });
});

describe('targetSummary', () => {
  test('main set + zone + targets', () => {
    expect(targetSummary(RUN_INTERVALS, T)).toBe("3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8");
  });

  test('without thresholds or steps it still says the zone and RPE', () => {
    expect(targetSummary({ sport: 'bike', intensity: 'endurance', steps: [] }, {})).toBe('Z2 · RPE 3–4');
    expect(targetSummary({ sport: 'rest', intensity: 'recovery', steps: [] }, T)).toBeNull();
  });
});

describe('sessionFeel', () => {
  test('main set cue first, else the zone sensations', () => {
    expect(sessionFeel(RUN_INTERVALS, T)).toMatch(/palabras sueltas/);
    const withCue = { ...RUN_INTERVALS, steps: [{ kind: 'work' as const, durationMin: 40, intensity: 'endurance' as const, cue: 'Nariz y boca relajadas.' }] };
    expect(sessionFeel(withCue, T)).toBe('Nariz y boca relajadas.');
  });
});

describe('prescriptionText', () => {
  test('objective, structure, keys, success and plan B as plain text', () => {
    const text = prescriptionText(
      {
        ...RUN_INTERVALS,
        coaching: {
          objective: 'Subir tu umbral sin pasarte.',
          keys: ['Mismo ritmo en las tres series.', 'Recupera trotando.'],
          success: 'Las tres series dentro de 162–168 ppm.',
          planB: '40\' suaves en Z2.',
        },
      },
      T,
    );
    expect(text).toContain('Objetivo: Subir tu umbral sin pasarte.');
    expect(text).toContain("• 3×8' · series · Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8.");
    expect(text).toContain('Claves:\n• Mismo ritmo en las tres series.');
    expect(text).toContain('Lo has hecho bien si: Las tres series dentro de 162–168 ppm.');
    expect(text).toContain("Si no es tu día: 40' suaves en Z2.");
    expect(text).not.toMatch(/[*#]/);
  });

  test('a session without steps gets an intensity line', () => {
    expect(prescriptionText({ sport: 'run', intensity: 'endurance', steps: [] }, T)).toMatch(/^Intensidad: Z2 · 145–151 ppm · 5:08–5:48 \/km · RPE 3–4\. Cómodo/);
  });
});
