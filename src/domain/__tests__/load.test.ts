import {
  complianceOf,
  computePmc,
  dailyLoads,
  estimateTss,
  INTENSITY_IF,
  isUnplanned,
  lifeEventLoad,
  rpeLoad,
  weeklyLoadForRamp,
  weekSummary,
  workoutLoad,
} from '../load';
import { makeEvent, makeWorkout } from './fixtures';

describe('estimateTss', () => {
  test('1 h at endurance on the bike is ~50 points (§3.2)', () => {
    expect(estimateTss({ sport: 'bike', durationMin: 60, intensity: 'endurance' })).toBeCloseTo(50, 0);
  });

  test('swim uses the cubic formula (IF³)', () => {
    const swim = estimateTss({ sport: 'swim', durationMin: 60, intensity: 'threshold' });
    expect(swim).toBeCloseTo(0.909 ** 3 * 100, 0);
  });

  test('run, brick, strength, mobility and rest', () => {
    expect(estimateTss({ sport: 'run', durationMin: 60, intensity: 'endurance' })).toBeCloseTo(55, 0);
    const brick = estimateTss({ sport: 'brick', durationMin: 120, intensity: 'endurance' });
    expect(brick).toBeGreaterThan(estimateTss({ sport: 'bike', durationMin: 120, intensity: 'endurance' }));
    expect(estimateTss({ sport: 'strength', durationMin: 60, intensity: 'tempo' })).toBe(35);
    expect(estimateTss({ sport: 'mobility', durationMin: 60, intensity: 'recovery' })).toBe(15);
    expect(estimateTss({ sport: 'rest', durationMin: 60, intensity: 'recovery' })).toBe(0);
    expect(estimateTss({ sport: 'bike', durationMin: 0, intensity: 'vo2' })).toBe(0);
    expect(INTENSITY_IF.threshold).toBeGreaterThan(INTENSITY_IF.endurance);
  });
});

describe('workoutLoad', () => {
  test('completed tss wins, then sRPE, then estimate', () => {
    expect(workoutLoad(makeWorkout({ status: 'completed', completed: { tss: 80 } }))).toBe(80);
    const rpe = workoutLoad(makeWorkout({ status: 'completed', durationMin: 60, completed: { durationMin: 60, rpe: 7 } }));
    expect(rpe).toBeCloseTo(rpeLoad(60, 7), 1);
    const estimate = workoutLoad(makeWorkout({ status: 'completed', durationMin: 60, completed: { durationMin: 30 } }));
    expect(estimate).toBeCloseTo(estimateTss({ sport: 'run', durationMin: 30, intensity: 'endurance' }), 1);
  });

  test('strength ignores RPE (table), planned uses planned tss or estimate', () => {
    const st = workoutLoad(makeWorkout({ sport: 'strength', status: 'completed', durationMin: 60, completed: { rpe: 9 } }));
    expect(st).toBe(35);
    expect(workoutLoad(makeWorkout({ tss: 70 }))).toBe(70);
    expect(workoutLoad(makeWorkout({ durationMin: 60 }))).toBeCloseTo(55, 0);
  });

  test('skipped and rest count 0', () => {
    expect(workoutLoad(makeWorkout({ status: 'skipped' }))).toBe(0);
    expect(workoutLoad(makeWorkout({ sport: 'rest' }))).toBe(0);
  });

  test('rpeLoad clamps the RPE', () => {
    expect(rpeLoad(60, 15)).toBe(rpeLoad(60, 10));
    expect(rpeLoad(60, 0)).toBe(rpeLoad(60, 1));
  });
});

describe('lifeEventLoad', () => {
  test('sports events have load by severity; others none', () => {
    const soft = lifeEventLoad(makeEvent({ kind: 'padel', severity: 1 }));
    const hard = lifeEventLoad(makeEvent({ kind: 'padel', severity: 3 }));
    expect(hard).toBeGreaterThan(soft);
    expect(lifeEventLoad(makeEvent({ kind: 'football', durationMin: null }))).toBeGreaterThan(90);
    expect(lifeEventLoad(makeEvent({ kind: 'work' }))).toBe(0);
  });
});

describe('dailyLoads + computePmc', () => {
  const range = { from: '2026-10-26', to: '2026-11-01' };
  const workouts = [
    makeWorkout({ id: 'a', date: '2026-10-26', status: 'completed', completed: { tss: 60 } }),
    makeWorkout({ id: 'b', date: '2026-10-28', tss: 50 }),
    makeWorkout({ id: 'c', date: '2026-12-01', status: 'completed', completed: { tss: 99 } }),
  ];

  test('only completed by default; planned with includePlanned (from a date)', () => {
    const done = dailyLoads(workouts, [], range);
    expect(done['2026-10-26']).toBe(60);
    expect(done['2026-10-28']).toBe(0);
    expect(Object.keys(done)).toHaveLength(7);
    const all = dailyLoads(workouts, [], range, { includePlanned: true });
    expect(all['2026-10-28']).toBe(50);
    const later = dailyLoads(workouts, [], range, { includePlanned: true, plannedFrom: '2026-10-29' });
    expect(later['2026-10-28']).toBe(0);
  });

  test('other-sport events add load on every day of the event', () => {
    const loads = dailyLoads([], [makeEvent({ startDate: '2026-10-27', endDate: '2026-10-28' })], range);
    expect(loads['2026-10-27']).toBeGreaterThan(0);
    expect(loads['2026-10-28']).toBe(loads['2026-10-27']);
  });

  test('PMC: TSB uses yesterday CTL − ATL; constant load converges', () => {
    const pmc = computePmc({ '2026-10-26': 100 }, range);
    expect(pmc[0]?.tsb).toBe(0);
    expect(pmc[0]?.atl).toBeGreaterThan(pmc[0]?.ctl ?? 0);
    expect(pmc[1]?.tsb).toBeLessThan(0);
    const long = { from: '2026-01-01', to: '2026-12-31' };
    const loads: Record<string, number> = {};
    for (const p of computePmc({}, long)) loads[p.date] = 50;
    const last = computePmc(loads, long).at(-1);
    expect(last?.ctl).toBeGreaterThan(49);
    expect(last?.atl).toBeCloseTo(50, 0);
  });

  test('PMC seed and invalid loads', () => {
    const pmc = computePmc({ '2026-10-26': Number.NaN }, range, { ctl: 50, atl: 70 });
    expect(pmc[0]?.tsb).toBe(-20);
    expect(pmc[0]?.load).toBe(0);
  });

  test('weekly load needed for a CTL ramp (§4.1 example: CTL 60, +5 ≈ 648)', () => {
    expect(weeklyLoadForRamp(60, 5)).toBeCloseTo(648, -1);
  });
});

describe('compliance', () => {
  const today = '2026-10-29';

  test('TrainingPeaks bands on duration', () => {
    const base = { status: 'completed' as const, durationMin: 60 };
    expect(complianceOf(makeWorkout({ ...base, completed: { durationMin: 60 } }), today)).toBe('done');
    expect(complianceOf(makeWorkout({ ...base, completed: { durationMin: 40 } }), today)).toBe('partial');
    expect(complianceOf(makeWorkout({ ...base, completed: { durationMin: 95 } }), today)).toBe('off');
    expect(complianceOf(makeWorkout({ ...base, completed: { durationMin: 20 } }), today)).toBe('off');
  });

  test('load first, distance as fallback', () => {
    expect(complianceOf(makeWorkout({ status: 'completed', tss: 100, completed: { tss: 130, durationMin: 60 } }), today)).toBe('partial');
    expect(complianceOf(makeWorkout({ status: 'completed', durationMin: 0, distanceM: 10000, completed: { distanceM: 10100 } }), today)).toBe('done');
    expect(complianceOf(makeWorkout({ status: 'completed', completed: {} }), today)).toBe('done');
  });

  test('missed, pending, adjusted, unplanned and rest', () => {
    expect(complianceOf(makeWorkout({ date: '2026-10-27' }), today)).toBe('missed');
    expect(complianceOf(makeWorkout({ date: '2026-10-29' }), today)).toBe('pending');
    expect(complianceOf(makeWorkout({ status: 'skipped' }), today)).toBe('adjusted');
    const imported = makeWorkout({ status: 'completed', source: 'garmin', externalId: 'garmin:1', completed: { durationMin: 30 } });
    expect(isUnplanned(imported)).toBe(true);
    expect(complianceOf(imported, today)).toBe('unplanned');
    expect(complianceOf(makeWorkout({ sport: 'rest', date: '2026-10-27' }), today)).toBe('done');
    expect(complianceOf(makeWorkout({ sport: 'rest', date: '2026-10-30' }), today)).toBe('pending');
  });
});

describe('weekSummary', () => {
  test('totals, per sport and duration-weighted compliance of due sessions', () => {
    const workouts = [
      makeWorkout({ id: '1', date: '2026-10-26', sport: 'run', durationMin: 60, status: 'completed', completed: { durationMin: 60, tss: 55 } }),
      makeWorkout({ id: '2', date: '2026-10-27', sport: 'bike', durationMin: 60 }),
      makeWorkout({ id: '3', date: '2026-10-28', sport: 'swim', durationMin: 40, status: 'skipped' }),
      makeWorkout({ id: '4', date: '2026-10-30', sport: 'bike', durationMin: 90 }),
      makeWorkout({ id: '5', date: '2026-10-29', sport: 'run', durationMin: 30, status: 'completed', source: 'garmin', externalId: 'g', completed: { durationMin: 30 } }),
      makeWorkout({ id: '6', date: '2026-10-29', sport: 'rest', durationMin: 0 }),
      makeWorkout({ id: '7', date: '2026-11-05', sport: 'run', durationMin: 30 }),
    ];
    const s = weekSummary(workouts, '2026-10-28', '2026-10-29');
    expect(s.plannedMin).toBe(60 + 60 + 40 + 90);
    expect(s.completedMin).toBe(90);
    expect(s.sessions).toBe(4);
    expect(s.completedSessions).toBe(1);
    expect(s.compliancePct).toBe(0.5);
    expect(s.bySport.run).toEqual({ plannedMin: 60, completedMin: 90, count: 2 });
    expect(s.completedTss).toBeGreaterThan(55);
  });

  test('null compliance when nothing is due', () => {
    expect(weekSummary([makeWorkout({ date: '2026-11-01' })], '2026-10-26', '2026-10-26').compliancePct).toBeNull();
  });
});

describe('activities logged by Claude without a plan (ENG-9)', () => {
  const logged = makeWorkout({
    id: 'claude-run',
    date: '2026-10-20',
    sport: 'run',
    durationMin: 60,
    status: 'completed',
    source: 'claude',
    externalId: null,
    createdAt: '2026-10-20T19:30:00.120Z',
    completed: { durationMin: 60, source: 'claude', completedAt: '2026-10-20T19:30:00.000Z' },
  });

  test('a row created already completed is unplanned and does not inflate the plan', () => {
    expect(isUnplanned(logged)).toBe(true);
    expect(complianceOf(logged, '2026-10-25')).toBe('unplanned');
    const s = weekSummary([logged], '2026-10-19', '2026-10-25');
    expect(s.plannedMin).toBe(0);
    expect(s.sessions).toBe(0);
    expect(s.completedSessions).toBe(0);
    expect(s.compliancePct).toBeNull();
    expect(s.completedMin).toBe(60);
  });

  test('a planned Claude session completed later still counts as planned', () => {
    const planned = { ...logged, id: 'claude-plan', createdAt: '2026-10-18T09:00:00.000Z' };
    expect(isUnplanned(planned)).toBe(false);
    expect(complianceOf(planned, '2026-10-25')).toBe('done');
    expect(isUnplanned({ ...logged, completed: { durationMin: 60 } })).toBe(false);
  });
});
