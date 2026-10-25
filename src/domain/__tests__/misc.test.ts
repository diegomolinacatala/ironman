import { FUELING_DISCLAIMER } from '../constants';
import { fuelingHint } from '../fueling';
import { lifeEventHardPoints, longPoints, workoutHardPoints } from '../hardness';
import { matchActivity } from '../matching';
import { buildSession, hardMinutes, SESSION_CATALOG, specHardPoints, specToDraft, type SessionCode } from '../sessions';
import { makeEvent, makeWorkout } from './fixtures';

describe('fuelingHint (§12.1)', () => {
  test('short easy sessions: water only', () => {
    const h = fuelingHint({ sport: 'run', durationMin: 45, intensity: 'endurance' });
    expect(h.carbsPerHour).toBe(0);
    expect(h.during).toMatch(/Agua/);
    expect(h.before).toMatch(/ayunas/);
  });

  test('short quality: carbs before, protein after', () => {
    const h = fuelingHint({ sport: 'run', durationMin: 45, intensity: 'threshold' });
    expect(h.before).toMatch(/hidratos/);
    expect(h.after).toMatch(/proteína/);
  });

  test('bands by duration, quality ≥ 75 min goes one band up', () => {
    expect(fuelingHint({ sport: 'bike', durationMin: 75, intensity: 'endurance' }).carbsPerHour).toBe(15);
    expect(fuelingHint({ sport: 'bike', durationMin: 120, intensity: 'endurance' }).carbsPerHour).toBe(45);
    expect(fuelingHint({ sport: 'bike', durationMin: 200, intensity: 'endurance' }).carbsPerHour).toBe(75);
    expect(fuelingHint({ sport: 'bike', durationMin: 80, intensity: 'threshold' }).carbsPerHour).toBe(45);
    expect(fuelingHint({ sport: 'brick', durationMin: 160, intensity: 'race' }).carbsPerHour).toBe(75);
    expect(fuelingHint({ sport: 'brick', durationMin: 160, intensity: 'race' }).during).toMatch(/plan de carrera/);
  });

  test('rest and strength have no carbs target', () => {
    expect(fuelingHint({ sport: 'rest', durationMin: 0, intensity: 'recovery' }).during).toBeNull();
    expect(fuelingHint({ sport: 'strength', durationMin: 45, intensity: 'tempo' }).carbsPerHour).toBeNull();
    expect(FUELING_DISCLAIMER).toMatch(/dietista/);
  });
});

describe('matchActivity', () => {
  const planned = [
    makeWorkout({ id: 'run-am', date: '2026-10-27', sport: 'run', durationMin: 45, startTime: '07:00' }),
    makeWorkout({ id: 'run-pm', date: '2026-10-27', sport: 'run', durationMin: 50, startTime: '19:00' }),
    makeWorkout({ id: 'brick', date: '2026-10-31', sport: 'brick', durationMin: 120 }),
    makeWorkout({ id: 'done', date: '2026-10-28', sport: 'bike', status: 'completed' }),
  ];

  test('same day and sport, closest start time', () => {
    expect(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 48, startTime: '18:40' }, planned)?.id).toBe('run-pm');
    expect(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 48, startTime: '07:10' }, planned)?.id).toBe('run-am');
  });

  test('brick ↔ bike, duration window 50-150 %', () => {
    expect(matchActivity({ date: '2026-10-31', sport: 'bike', durationMin: 90 }, planned)?.id).toBe('brick');
    expect(matchActivity({ date: '2026-10-31', sport: 'bike', durationMin: 30 }, planned)).toBeNull();
    expect(matchActivity({ date: '2026-10-28', sport: 'bike', durationMin: 60 }, planned)).toBeNull();
    expect(matchActivity({ date: '2026-10-27', sport: 'swim', durationMin: 45 }, planned)).toBeNull();
  });

  test('without start times the closest duration wins', () => {
    expect(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 51 }, planned)?.id).toBe('run-pm');
  });
});

describe('hardness (§10.1)', () => {
  test('quality, long scaling, brick, strength, swim', () => {
    expect(workoutHardPoints({ sport: 'run', intensity: 'threshold', durationMin: 50 })).toBe(1);
    expect(workoutHardPoints({ sport: 'run', intensity: 'endurance', durationMin: 90 })).toBe(1);
    expect(workoutHardPoints({ sport: 'run', intensity: 'endurance', durationMin: 65 })).toBe(0.5);
    expect(workoutHardPoints({ sport: 'run', intensity: 'endurance', durationMin: 40 })).toBe(0);
    expect(workoutHardPoints({ sport: 'bike', intensity: 'endurance', durationMin: 150 })).toBe(1);
    expect(workoutHardPoints({ sport: 'bike', intensity: 'endurance', durationMin: 130 })).toBe(0.5);
    expect(workoutHardPoints({ sport: 'brick', intensity: 'endurance', durationMin: 90 })).toBe(1.5);
    expect(workoutHardPoints({ sport: 'brick', intensity: 'race', durationMin: 330 })).toBe(3);
    expect(workoutHardPoints({ sport: 'strength', intensity: 'tempo', durationMin: 45 })).toBe(0.5);
    expect(workoutHardPoints({ sport: 'strength', intensity: 'endurance', durationMin: 30 })).toBe(0.25);
    expect(workoutHardPoints({ sport: 'swim', intensity: 'threshold', durationMin: 50 })).toBe(0.5);
    expect(workoutHardPoints({ sport: 'other', intensity: 'threshold', durationMin: 60 })).toBe(1);
    expect(workoutHardPoints({ sport: 'other', intensity: 'endurance', durationMin: 60 })).toBe(0.5);
    expect(workoutHardPoints({ sport: 'mobility', intensity: 'recovery', durationMin: 20 })).toBe(0);
    expect(longPoints('bike', 'tempo', 100)).toBe(1);
  });

  test('pádel and fútbol always count as hard; work does not', () => {
    expect(lifeEventHardPoints(makeEvent({ kind: 'padel', severity: 1 }))).toBeGreaterThanOrEqual(1);
    expect(lifeEventHardPoints(makeEvent({ kind: 'football', severity: 2 }))).toBe(1.5);
    expect(lifeEventHardPoints(makeEvent({ kind: 'other_sport', severity: 1, durationMin: 120 }))).toBe(1);
    expect(lifeEventHardPoints(makeEvent({ kind: 'work' }))).toBe(0);
  });
});

describe('session catalog', () => {
  const codes = Object.keys(SESSION_CATALOG) as SessionCode[];

  test('every code builds a Spanish title, description and consistent steps', () => {
    for (const code of codes) {
      const spec = { code, durationMin: code === 'BRICK' ? 150 : 60, priority: 3, brickRunMin: 30, raceName: 'Test' };
      const content = buildSession(spec);
      expect(content.title.length).toBeGreaterThan(3);
      expect(content.description.length).toBeGreaterThan(10);
      expect(content.title).not.toMatch(/ironman|70\.3/i);
      for (const step of content.steps) {
        expect(['warmup', 'work', 'recovery', 'cooldown', 'rest']).toContain(step.kind);
        if (step.durationMin !== undefined) expect(step.durationMin).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('timed interval sessions add up to the session duration', () => {
    for (const code of ['BK_THR', 'BK_TEMPO', 'BK_SST', 'BK_VO2', 'BK_RP', 'RN_THR', 'RN_TEMPO', 'RN_VO2', 'RN_HILLS', 'BK_END', 'BK_LONG'] as SessionCode[]) {
      for (const durationMin of [45, 60, 75, 90, 150]) {
        const steps = buildSession({ code, durationMin, priority: 2 }).steps;
        const total = steps.reduce((s, st) => s + (st.durationMin ?? 0) * (st.repeat ?? 1), 0);
        expect(Math.abs(total - durationMin)).toBeLessThanOrEqual(durationMin < 60 ? 15 : 5);
      }
    }
  });

  test('titles reflect the interval structure', () => {
    expect(buildSession({ code: 'BK_THR', durationMin: 75, priority: 2 }).title).toBe("Bici umbral 3×10'");
    expect(buildSession({ code: 'RN_LONG', durationMin: 90, priority: 1, racePace: true, distanceM: 15000 }).description).toMatch(/15 km/);
    expect(buildSession({ code: 'BRICK', durationMin: 170, priority: 1, brickRunMin: 30, racePace: true }).title).toBe("Brick: bici 2h 20' + carrera 30'");
    expect(buildSession({ code: 'BK_LONG', durationMin: 200, priority: 1, racePace: true }).title).toMatch(/ritmo de carrera/);
    expect(buildSession({ code: 'MOB', durationMin: 20, priority: 7, note: 'Extra.' }).description).toMatch(/Extra\.$/);
  });

  test('hard points and hard minutes of catalog sessions', () => {
    expect(specHardPoints({ code: 'RN_LONG', durationMin: 70, priority: 2 })).toBe(0.5);
    expect(specHardPoints({ code: 'RN_LONG', durationMin: 80, priority: 2 })).toBe(1);
    expect(specHardPoints({ code: 'BRICK', durationMin: 120, priority: 1 })).toBe(1.5);
    expect(specHardPoints({ code: 'SW_CSS', durationMin: 50, priority: 3 })).toBe(0.5);
    expect(specHardPoints({ code: 'ST_HEAVY', durationMin: 45, priority: 4 })).toBe(0.5);
    expect(specHardPoints({ code: 'ST_MAINT', durationMin: 30, priority: 6 })).toBe(0.25);
    expect(specHardPoints({ code: 'RACE', durationMin: 330, priority: 0 })).toBe(3);
    expect(specHardPoints({ code: 'BK_END', durationMin: 90, priority: 5 })).toBe(0);
    expect(hardMinutes({ code: 'BK_END', durationMin: 90, priority: 5 })).toBe(0);
    expect(hardMinutes({ code: 'RN_THR', durationMin: 55, priority: 2 })).toBeGreaterThan(15);
  });

  test('specToDraft produces a rules workout draft', () => {
    const draft = specToDraft({ code: 'RN_THR', durationMin: 55, priority: 1 }, '2026-10-27', '18:00');
    expect(draft).toEqual(expect.objectContaining({ date: '2026-10-27', startTime: '18:00', sport: 'run', intensity: 'threshold', isKey: true, source: 'rules' }));
    expect(draft.tss).toBeGreaterThan(0);
    expect(draft.steps?.length).toBeGreaterThan(2);
  });
});
