/**
 * How a B/C race is prepared (`Race.prep`): 'training' (como entreno), 'taper'
 * (solo afinar, the B default) and 'specific' (preparación específica: race-pace
 * sessions for that race in the 2 weeks before its race week).
 */
import { phaseFor, racePrepOf } from '../periodization';
import { planWeek } from '../planner';
import { raceWeekSessions, specializeForRace } from '../plannerSupport';
import { buildSeason } from '../season';
import type { SessionSpec } from '../sessions';
import type { PlanChange, RacePrep, WorkoutDraft } from '../types';
import { zoneTargets } from '../zones';
import { makeProfile, makeRace, NEXT_MONDAY } from './fixtures';

/** A race: Medio de Valencia, 25 Apr 2027 (build from late January). */
const halfA = makeRace({ id: 'a', date: '2027-04-25', distance: 'half', priority: 'A' });
/** B race on Sunday 7 March 2027: race week from 1 March. */
const olympicB = (prep?: RacePrep | null) =>
  makeRace({ id: 'b', name: 'Olímpico de Madrid', date: '2027-03-07', distance: 'olympic', priority: 'B', ...(prep === undefined ? {} : { prep }) });

const THRESHOLDS = { ftpW: 250, lthr: 170, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 100 };

function drafts(changes: PlanChange[]): WorkoutDraft[] {
  return changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

const specificFor = (d: WorkoutDraft) => d.description?.includes('Específica para Olímpico de Madrid') ?? false;

describe('racePrepOf', () => {
  test('the race choice, else B taper and C training; A races have none', () => {
    expect(racePrepOf({ priority: 'B', prep: 'specific' })).toBe('specific');
    expect(racePrepOf({ priority: 'B', prep: null })).toBe('taper');
    expect(racePrepOf({ priority: 'C' })).toBe('training');
    expect(racePrepOf({ priority: 'C', prep: 'taper' })).toBe('taper');
    expect(racePrepOf({ priority: 'A', prep: 'training' })).toBeNull();
  });
});

describe('periodization by preparation', () => {
  const shape = (date: string, prep?: RacePrep | null) => {
    const p = phaseFor(date, [halfA, olympicB(prep)]);
    return { phase: p.phase, volumeFactor: p.volumeFactor, focus: p.focus, specificPrep: p.specificPrep };
  };

  test('specific: 1 race-pace session two weeks before the race week, 2 the week before, then the mini-taper', () => {
    expect(shape('2027-02-08', 'specific').specificPrep).toBeNull();
    const two = phaseFor('2027-02-15', [halfA, olympicB('specific')]);
    const one = phaseFor('2027-02-22', [halfA, olympicB('specific')]);
    expect(two.specificPrep).toMatchObject({ race: { id: 'b' }, sessions: 1 });
    expect(one.specificPrep).toMatchObject({ race: { id: 'b' }, sessions: 2 });
    expect(one.focus).toMatch(/Preparación específica para Olímpico de Madrid: 2 sesiones a su ritmo\./);
    // The A race keeps the phase and the volume of those weeks.
    expect(two.phase).toBe('build');
    expect(two.volumeFactor).toBe(phaseFor('2027-02-15', [halfA]).volumeFactor);
    const raceWeek = shape('2027-03-01', 'specific');
    expect(raceWeek.specificPrep).toBeNull();
    expect(raceWeek.focus).toMatch(/Carrera B esta semana: mini-taper de 3-5 días tras su preparación específica/);
    expect(raceWeek.volumeFactor).toBe(shape('2027-03-01', 'taper').volumeFactor);
    expect(shape('2027-03-09', 'specific').phase).toBe('recovery');
  });

  test('taper is the old B behaviour and the default', () => {
    const normal = phaseFor('2027-03-01', [halfA]);
    const taper = shape('2027-03-01', 'taper');
    expect(shape('2027-03-01', null)).toEqual(taper);
    expect(shape('2027-03-01')).toEqual(taper);
    expect(taper.volumeFactor).toBeCloseTo(normal.volumeFactor * 0.65, 1);
    expect(taper.focus).toMatch(/Carrera B esta semana: mini-taper de 3-5 días\./);
    expect(shape('2027-03-09', 'taper').phase).toBe('recovery');
    expect(shape('2027-02-22', 'taper').specificPrep).toBeNull();
  });

  test('training: no mini-taper and no recovery week after; a C race chosen "taper" gets them', () => {
    const normal = phaseFor('2027-03-01', [halfA]);
    const training = shape('2027-03-01', 'training');
    expect(training.volumeFactor).toBeCloseTo(normal.volumeFactor * 0.9, 1);
    expect(training.focus).toMatch(/Carrera B esta semana: como un entreno, el día antes suave\./);
    expect(shape('2027-03-09', 'training').phase).toBe('build');
    const cTaper = makeRace({ id: 'c', date: '2027-03-07', distance: 'olympic', priority: 'C', prep: 'taper' });
    expect(phaseFor('2027-03-09', [halfA, cTaper]).phase).toBe('recovery');
    expect(phaseFor('2027-03-01', [halfA, cTaper]).volumeFactor).toBe(taperFactorWeek());
  });

  function taperFactorWeek(): number {
    return phaseFor('2027-03-01', [halfA, olympicB('taper')]).volumeFactor;
  }
});

describe('race-week sessions by preparation', () => {
  const race = (priority: 'B' | 'C', prep?: RacePrep) => makeRace({ id: 'x', date: '2026-11-01', priority, distance: 'olympic', ...(prep ? { prep } : {}) });
  const codes = (r: ReturnType<typeof race>) => raceWeekSessions(r, false, 'tri_short', NEXT_MONDAY).map((s) => s.code);

  test('training: the race alone; taper and specific: activation the day before', () => {
    expect(codes(race('B', 'training'))).toEqual(['RACE']);
    expect(codes(race('C'))).toEqual(['RACE']);
    expect(codes(race('B'))).toEqual(['RACE', 'ACTIVATION']);
    expect(codes(race('B', 'specific'))).toEqual(['RACE', 'ACTIVATION']);
    expect(codes(race('C', 'taper'))).toEqual(['RACE', 'ACTIVATION']);
  });
});

describe('specializeForRace', () => {
  const week: SessionSpec[] = [
    { code: 'BRICK', durationMin: 170, brickRunMin: 30, racePace: true, longBrick: true, priority: 1 },
    { code: 'BK_THR', durationMin: 75, priority: 2 },
    { code: 'RN_THR', durationMin: 50, priority: 3 },
    { code: 'RN_LONG', durationMin: 80, priority: 1 },
    { code: 'RN_EASY', durationMin: 40, priority: 5 },
  ];
  const b = olympicB('specific');

  test('quality sessions become race-pace sets for that race, bike first; long sessions keep serving the A race', () => {
    const one = specializeForRace(week, { race: b, sessions: 1 });
    expect(one.map((s) => s.code)).toEqual(['BRICK', 'BK_RP', 'RN_THR', 'RN_LONG', 'RN_EASY']);
    expect(one[1]).toMatchObject({ raceDistance: 'olympic', specificFor: 'Olímpico de Madrid', priority: 2 });
    const two = specializeForRace(week, { race: b, sessions: 2 });
    expect(two.map((s) => s.code)).toEqual(['BRICK', 'BK_RP', 'RN_RP', 'RN_LONG', 'RN_EASY']);
    expect(two[2]).toMatchObject({ raceDistance: 'olympic', priority: 2 });
    expect(two[0]).toBe(week[0]);
    expect(specializeForRace(week, null)).toEqual(week);
  });

  test('a short race-pace brick goes first; a running race only takes runs', () => {
    const shortBrick: SessionSpec = { code: 'BRICK', durationMin: 60, brickRunMin: 15, racePace: true, priority: 2 };
    expect(specializeForRace([...week, shortBrick], { race: b, sessions: 1 }).at(-1)).toMatchObject({ code: 'BRICK', specificFor: 'Olímpico de Madrid' });
    const tenK = makeRace({ id: 'k', name: '10K de Getafe', distance: 'run_10k', priority: 'B', prep: 'specific' });
    const out = specializeForRace(week, { race: tenK, sessions: 2 });
    expect(out.map((s) => s.code)).toEqual(['BRICK', 'BK_THR', 'RN_RP', 'RN_LONG', 'RN_EASY']);
  });
});

describe('weekly planner by preparation', () => {
  const profile = makeProfile({ thresholds: THRESHOLDS, availability: { ...makeProfile().availability, weeklyHoursTarget: 9 } });
  const plan = (weekStart: string, prep?: RacePrep | null) =>
    planWeek({ weekStart, profile, races: [halfA, olympicB(prep)], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [] });

  test('specific weeks: more sessions at the B race pace as it gets closer', () => {
    const two = drafts(plan('2027-02-15', 'specific').changes).filter(specificFor);
    const one = drafts(plan('2027-02-22', 'specific').changes).filter(specificFor);
    expect(two).toHaveLength(1);
    expect(one).toHaveLength(2);
    for (const d of [...two, ...one]) expect(d.isKey).toBe(true);
    // Their race-pace blocks use the olympic pace, not the half's.
    const bike = one.find((d) => d.sport === 'bike');
    const block = bike?.steps?.find((s) => s.intensity === 'race');
    const olympicPower = zoneTargets('bike', 'race', THRESHOLDS, { raceDistance: 'olympic' }).power;
    expect(block?.target?.power).toEqual(olympicPower);
    expect(olympicPower).not.toEqual(zoneTargets('bike', 'race', THRESHOLDS, { raceDistance: 'half' }).power);
    expect(plan('2027-02-22', 'specific').summary).toMatch(/Preparación específica para Olímpico de Madrid/);
  });

  test('taper weeks before the race are the plan without the B race; training has no activation and more volume', () => {
    expect(drafts(plan('2027-02-22', 'taper').changes).filter(specificFor)).toEqual([]);
    expect(plan('2027-02-22', 'taper').changes).toEqual(planWeek({ weekStart: '2027-02-22', profile, races: [halfA], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [] }).changes);
    const taperWeek = plan('2027-03-01', 'taper');
    const trainingWeek = plan('2027-03-01', 'training');
    expect(drafts(taperWeek.changes).some((d) => d.title.startsWith('Activación'))).toBe(true);
    expect(drafts(trainingWeek.changes).some((d) => d.title.startsWith('Activación'))).toBe(false);
    expect(trainingWeek.targetMinutes).toBeGreaterThan(taperWeek.targetMinutes);
  });
});

describe('Plan → General describes the preparation', () => {
  const season = (prep: RacePrep) => buildSeason({ today: '2027-02-15', races: [halfA, olympicB(prep)], level: 'intermediate', weeklyHoursTarget: 8 });

  test('specific weeks and the race week say what they are for', () => {
    const weeks = season('specific').weeks;
    expect(weeks[0]?.why).toBe('Preparación específica para Olímpico de Madrid: 1 sesión a su ritmo; tu carrera A sigue mandando.');
    expect(weeks[1]?.why).toMatch(/2 sesiones a su ritmo/);
    expect(weeks[2]?.label).toBe('Carrera B');
    expect(weeks[2]?.why).toMatch(/mini-afinamiento de 3–5 días tras dos semanas con sesiones a su ritmo/);
  });

  test('taper and training race weeks', () => {
    expect(season('taper').weeks[2]?.why).toMatch(/Carrera B: mini-afinamiento de 3–5 días/);
    expect(season('taper').weeks[0]?.why).not.toMatch(/Preparación específica/);
    expect(season('training').weeks[2]?.why).toMatch(/Carrera B: la haces como un entreno de calidad, sin afinar/);
  });
});
