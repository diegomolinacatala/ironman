import { validateCoaching } from '../changes';
import { buildSession, hardMinutes, SESSION_CATALOG, specToDraft, type SessionCode, type SessionSpec } from '../sessions';
import type { Thresholds, WorkoutStep } from '../types';
import { workoutCoachingSchema } from '../validation';

const T: Thresholds = { lthr: 170, maxHr: 190, runThresholdPaceSecPerKm: 270, ftpW: 250, swimCssSecPer100m: 105 };
const CTX = { thresholds: T, raceDistance: 'half' as const };
const CODES = Object.keys(SESSION_CATALOG) as SessionCode[];
const DURATIONS = [30, 45, 60, 75, 90, 150, 200];

function spec(code: SessionCode, durationMin: number, extra: Partial<SessionSpec> = {}): SessionSpec {
  return { code, durationMin, priority: 3, brickRunMin: 20, raceName: 'Medio de Valencia', ...extra };
}

/** What the planner's rules depend on: kind, amount, repeat and intensity of every step. */
function shape(steps: readonly WorkoutStep[]) {
  return steps.map(({ kind, durationMin, distanceM, repeat, intensity }) => ({ kind, durationMin, distanceM, repeat, intensity }));
}

function allCopy(code: SessionCode, d: number, extra: Partial<SessionSpec> = {}): string[] {
  const content = buildSession(spec(code, d, extra), CTX);
  const c = content.coaching;
  return [content.title, content.description, c.objective, ...c.keys, c.success, c.planB ?? '', ...content.steps.flatMap((s) => [s.note ?? '', s.cue ?? ''])];
}

describe('session prescriptions (coaching)', () => {
  test('every code and duration has a complete coaching within the database limits', () => {
    for (const code of CODES) {
      for (const d of DURATIONS) {
        for (const ctx of [{}, CTX]) {
          const { coaching } = buildSession(spec(code, d, { racePace: d >= 90 }), ctx);
          expect(coaching.objective.length).toBeGreaterThan(20);
          expect(coaching.objective.length).toBeLessThanOrEqual(200);
          expect(coaching.keys.length).toBeGreaterThanOrEqual(2);
          expect(coaching.keys.length).toBeLessThanOrEqual(4);
          for (const key of coaching.keys) expect(key.length).toBeLessThanOrEqual(160);
          expect(coaching.success.length).toBeLessThanOrEqual(200);
          expect(coaching.planB === null || coaching.planB.length <= 200).toBe(true);
          expect(validateCoaching(coaching)).toBeNull();
          expect(workoutCoachingSchema.safeParse(coaching).success).toBe(true);
        }
      }
    }
  });

  test('copy has no raw decimals, placeholders or English leftovers', () => {
    for (const code of CODES) {
      for (const d of DURATIONS) {
        for (const text of allCopy(code, d, { racePace: d >= 90, distanceM: 15500 })) {
          expect(text).not.toMatch(/\d\.\d|undefined|null|NaN|\$\{/);
        }
      }
    }
  });

  test('thresholds and race distance add numbers, never change the structure', () => {
    for (const code of CODES) {
      for (const d of DURATIONS) {
        const plain = buildSession(spec(code, d, { racePace: true }));
        const withCtx = buildSession(spec(code, d, { racePace: true }), CTX);
        expect(shape(withCtx.steps)).toEqual(shape(plain.steps));
        expect(withCtx.title).toBe(plain.title);
      }
    }
  });

  test('hard minutes of the interval sessions are unchanged', () => {
    expect(hardMinutes(spec('RN_THR', 60))).toBe(24);
    expect(hardMinutes(spec('BK_THR', 75))).toBe(30);
    expect(hardMinutes(spec('RN_HILLS', 60))).toBe(12.5);
    expect(hardMinutes(spec('RN_EASY', 45))).toBe(3);
    expect(hardMinutes(spec('ACTIVATION', 25, { sport: 'run' }))).toBe(4);
  });

  test('success criteria carry the athlete numbers when the thresholds are known', () => {
    const thr = buildSession(spec('RN_THR', 60), CTX);
    expect(thr.title).toBe("Series umbral 3×8'");
    expect(thr.coaching.success).toBe('Las tres series en Z4 (162–168 ppm, 4:27–4:44 /km), la última igual que la primera, y acabas con RPE 7–8.');
    expect(buildSession(spec('RN_THR', 60)).coaching.success).toBe('Las tres series en Z4, la última igual que la primera, y acabas con RPE 7–8.');
    expect(buildSession(spec('BK_END', 90), CTX).coaching.keys.join(' ')).toMatch(/\d+–\d+ W, \d+–\d+ ppm/);
    expect(buildSession(spec('SW_CSS', 50), CTX).coaching.keys.join(' ')).toMatch(/1:44–1:47 \/100 m/);
  });

  test('explicit targets only where the zone is not enough', () => {
    const work = (code: SessionCode, d: number, extra: Partial<SessionSpec> = {}) =>
      buildSession(spec(code, d, extra), CTX).steps.filter((s) => s.kind === 'work');
    expect(work('BK_SST', 75)[0]?.target).toEqual({ power: { min: 220, max: 235 }, hr: { min: 149, max: 157 }, rpe: { min: 6, max: 7 } });
    expect(work('SW_END', 60)[0]?.target).toEqual({ pace: { min: 111, max: 115 } });
    expect(work('SW_CSS', 60)[0]?.target).toEqual({ pace: { min: 104, max: 107 } });
    expect(work('SW_SPEED', 60)[0]?.target).toEqual({ pace: { min: 99, max: 101 } });
    expect(work('RN_HILLS', 60)[0]?.target).toEqual({ rpe: { min: 8, max: 9 } });
    expect(work('RN_HILLS', 60)[0]?.cue).toMatch(/pulso va con retraso/);
    expect(work('RN_EASY', 45)[1]?.target).toEqual({ rpe: { min: 7, max: 8 } });
    expect(work('RN_LONG', 90, { racePace: true })[1]?.target).toEqual({ hr: { min: 156, max: 163 }, pace: { min: 278, max: 294 }, rpe: { min: 6, max: 7 } });
    expect(work('BK_THR', 75).every((s) => s.target === undefined)).toBe(true);
    expect(work('RN_EASY', 45)[0]?.target).toBeUndefined();
    // Without the CSS or the race distance there are no explicit numbers to fix.
    expect(buildSession(spec('SW_END', 60)).steps.some((s) => s.target)).toBe(false);
    expect(buildSession(spec('BK_RP', 75), { thresholds: T }).steps.some((s) => s.target)).toBe(false);
  });

  test('bricks tag every step with its leg and give race targets per leg', () => {
    const short = buildSession(spec('BRICK', 45, { brickRunMin: 10, racePace: true }), CTX);
    expect(short.steps.map((s) => s.leg)).toEqual(['bike', 'bike', 'run']);
    expect(short.steps[1]?.target?.power).toEqual({ min: 190, max: 215 });
    expect(short.steps[2]?.target?.pace).toBeDefined();
    const long = buildSession(spec('BRICK', 200, { brickRunMin: 30, racePace: true }), CTX);
    expect(long.steps.every((s) => s.leg !== undefined)).toBe(true);
    expect(long.steps.at(-1)?.leg).toBe('run');
    expect(long.coaching.keys.join(' ')).toMatch(/zancada corta/);
  });

  test('known copy bugs are fixed', () => {
    const hills = buildSession(spec('RN_HILLS', 60));
    expect(`${hills.title} ${hills.description}`).not.toMatch(/\d\.\d/);
    const easy = buildSession(spec('RN_EASY', 45));
    expect(easy.description).toMatch(/30"/);
    expect(easy.description).not.toMatch(/20"/);
    const activation = buildSession(spec('ACTIVATION', 25, { sport: 'run' }));
    expect(activation.steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0)).toBe(25);
    const tempo = buildSession(spec('BK_TEMPO', 75));
    expect(tempo.description.split('. ').length).toBe(1);
  });

  test('a session that only fits one block talks about one block', () => {
    const single = (['BK_TEMPO', 'BK_SST', 'BK_RP', 'RN_TEMPO'] as const).map((code) => buildSession(spec(code, 30), CTX));
    for (const s of single) {
      expect(s.steps.find((x) => x.kind === 'work')?.repeat).toBe(1);
      expect(s.title).not.toMatch(/1×/);
      expect(s.description).toMatch(/^Un bloque de \d+' en /);
      const copy = [s.coaching.success, ...s.coaching.keys].join(' ');
      expect(copy).not.toMatch(/entre series|la última|las series|los bloques|\bSeries\b/);
    }
    expect(single[2]?.coaching.success).toMatch(/^El bloque entero al mismo ritmo \(190–215 W/);
    expect(buildSession(spec('BK_RP', 60), CTX).title).toBe("Bici a ritmo de carrera 2×15'");
  });

  test('plain easy runs drop the strides (downgrades and plan B)', () => {
    const plain = buildSession(spec('RN_EASY', 40, { plain: true }), CTX);
    expect(shape(plain.steps)).toEqual([{ kind: 'work', durationMin: 40, distanceM: undefined, repeat: undefined, intensity: 'endurance' }]);
    expect(plain.coaching.keys.join(' ')).not.toMatch(/rectas/i);
  });

  test('plan B follows the easier version and the race keeps its own', () => {
    expect(buildSession(spec('RN_THR', 60), CTX).coaching.planB).toMatch(/^Cambia la sesión por 40' de rodaje en Z2 \(145–151 ppm/);
    expect(buildSession(spec('BRICK', 120, { brickRunMin: 30 }), CTX).coaching.planB).toMatch(/^Quédate solo con la bici/);
    expect(buildSession(spec('RACE', 300, { sport: 'brick' }), CTX).coaching.planB).toMatch(/^Cambia el objetivo a terminar/);
    expect(buildSession(spec('RACE', 300, { sport: 'brick' }), CTX).coaching.keys.join(' ')).toMatch(/en bici, \d+–\d+ W; a pie, \d+–\d+ ppm/);
  });

  test("a B race and its activation use that race's pace, not the target race's", () => {
    const target = buildSession(spec('RACE', 300, { sport: 'brick' }), { thresholds: T, raceDistance: 'full' });
    const bRace = buildSession(spec('RACE', 150, { sport: 'brick', raceDistance: 'olympic' }), { thresholds: T, raceDistance: 'full' });
    const pacing = (keys: readonly string[]) => keys.find((k) => k.startsWith('Ritmo de carrera'));
    expect(pacing(bRace.coaching.keys)).toBeDefined();
    expect(pacing(bRace.coaching.keys)).not.toBe(pacing(target.coaching.keys));
    expect(pacing(bRace.coaching.keys)).toBe(pacing(buildSession(spec('RACE', 150, { sport: 'brick' }), { thresholds: T, raceDistance: 'olympic' }).coaching.keys));
    const activation = buildSession(spec('ACTIVATION', 25, { sport: 'run', raceDistance: 'olympic' }), { thresholds: T, raceDistance: 'full' });
    const olympicRun = buildSession(spec('ACTIVATION', 25, { sport: 'run' }), { thresholds: T, raceDistance: 'olympic' });
    expect(activation.steps.find((s) => s.intensity === 'race')?.target).toEqual(olympicRun.steps.find((s) => s.intensity === 'race')?.target);
  });

  test('specToDraft carries coaching and targets', () => {
    const draft = specToDraft({ code: 'BK_SST', durationMin: 75, priority: 2 }, '2026-11-10', '18:00', CTX);
    expect(draft.coaching?.objective).toMatch(/sweet spot/);
    expect(draft.steps?.find((s) => s.kind === 'work')?.target?.power).toEqual({ min: 220, max: 235 });
    expect(specToDraft({ code: 'MOB', durationMin: 20, priority: 7 }, '2026-11-10', null).coaching?.keys.length).toBeGreaterThanOrEqual(2);
  });
});
