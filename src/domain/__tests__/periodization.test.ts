import { addDays } from '../dates';
import { distanceKindOf, nextRace, phaseFor } from '../periodization';
import { makeRace } from './fixtures';

const halfA = makeRace({ id: 'a', date: '2027-04-25', distance: 'half', priority: 'A' });

describe('nextRace', () => {
  test('prefers the next A race, else the next of any priority', () => {
    const b = makeRace({ id: 'b', date: '2027-01-10', priority: 'B', distance: 'olympic' });
    expect(nextRace([b, halfA], '2026-10-25')?.id).toBe('a');
    expect(nextRace([b], '2026-10-25')?.id).toBe('b');
    expect(nextRace([b], '2027-02-01')).toBeNull();
  });
});

describe('distanceKindOf', () => {
  test('families', () => {
    expect(distanceKindOf('full')).toBe('tri_long');
    expect(distanceKindOf('sprint')).toBe('tri_short');
    expect(distanceKindOf('run_marathon')).toBe('run');
    expect(distanceKindOf(null, ['run', 'strength'])).toBe('run');
    expect(distanceKindOf(null)).toBe('tri_short');
  });
});

describe('phaseFor (backwards from the A race)', () => {
  test('race week, taper and peak for a half', () => {
    const race = phaseFor('2027-04-19', [halfA]);
    expect(race.phase).toBe('race_week');
    expect(race.weeksToRace).toBe(0);
    expect(race.daysToRace).toBe(6);
    expect(race.raceInWeek?.id).toBe('a');
    expect(race.volumeFactor).toBeLessThan(0.5);
    expect(phaseFor('2027-04-12', [halfA]).phase).toBe('taper');
    expect(phaseFor('2027-04-05', [halfA]).phase).toBe('peak');
  });

  test('taper factors decrease towards the race', () => {
    const peak = phaseFor('2027-04-05', [halfA]).volumeFactor;
    const taper = phaseFor('2027-04-12', [halfA]).volumeFactor;
    const raceWeek = phaseFor('2027-04-19', [halfA]).volumeFactor;
    expect(peak).toBeGreaterThan(taper);
    expect(taper).toBeGreaterThan(raceWeek);
  });

  test('build then base further out, maintenance far away', () => {
    expect(phaseFor('2027-03-01', [halfA]).phase).toBe('build');
    expect(phaseFor('2027-03-01', [halfA]).subphase).toBe('build2');
    expect(phaseFor('2027-02-01', [halfA]).subphase).toBe('build1');
    expect(phaseFor('2026-12-07', [halfA]).phase).toBe('base');
    const far = phaseFor('2026-01-05', [halfA]);
    expect(far.subphase).toBe('maintenance');
    expect(far.focus).toBeTruthy();
  });

  test('3:1 recovery cadence: one recovery week in every 4 load weeks', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => phaseFor(addDays('2027-03-29', -7 * i), [halfA]));
    const recovery = weeks.filter((w) => w.isRecoveryWeek).length;
    expect(recovery).toBe(3);
    const recoveryWeek = weeks.find((w) => w.isRecoveryWeek);
    expect(recoveryWeek?.focus).toMatch(/descarga/);
  });

  test('beginners and high life stress use 2:1', () => {
    const weeks = Array.from({ length: 9 }, (_, i) => phaseFor(addDays('2027-03-29', -7 * i), [halfA], { level: 'beginner' }));
    expect(weeks.every((w) => w.cadence === '2:1')).toBe(true);
    expect(weeks.filter((w) => w.isRecoveryWeek)).toHaveLength(3);
    expect(phaseFor('2027-03-29', [halfA], { lifeStress: true }).cadence).toBe('2:1');
  });

  test('transition after an A race and post-B recovery', () => {
    const after = phaseFor('2027-04-28', [halfA]);
    expect(after.phase).toBe('transition');
    expect(after.isRecoveryWeek).toBe(true);
    const b = makeRace({ id: 'b', date: '2027-01-10', priority: 'B', distance: 'olympic' });
    expect(phaseFor('2027-01-12', [b, halfA]).phase).toBe('recovery');
  });

  test('no races: maintenance base', () => {
    const p = phaseFor('2026-10-26', []);
    expect(p.phase).toBe('base');
    expect(p.targetRace).toBeNull();
    expect(p.weeksToRace).toBeNull();
    expect(p.volumeFactor).toBeGreaterThan(0.4);
  });

  test('B race inside an A build gets a mini-taper', () => {
    const b = makeRace({ id: 'b', date: '2027-03-07', priority: 'B', distance: 'olympic' });
    const normal = phaseFor('2027-03-01', [halfA]);
    const withB = phaseFor('2027-03-01', [halfA, b]);
    expect(withB.raceInWeek?.id).toBe('b');
    expect(withB.volumeFactor).toBeLessThan(normal.volumeFactor);
    expect(withB.focus).toMatch(/mini-taper/);
    const c = makeRace({ id: 'c', date: '2027-03-07', priority: 'C', distance: 'run_10k' });
    expect(phaseFor('2027-03-01', [halfA, c]).focus).toMatch(/Carrera C/);
  });

  test('only a B race: lighter race week', () => {
    const b = makeRace({ id: 'b', date: '2026-11-29', priority: 'B', distance: 'olympic' });
    const p = phaseFor('2026-11-23', [b]);
    expect(p.phase).toBe('race_week');
    expect(p.volumeFactor).toBeGreaterThan(0.5);
  });

  test('A race too close for a full plan: survival plan (no build) and PLAN_TOO_SHORT (ENG-6)', () => {
    const full = makeRace({ id: 'f', name: 'Distancia completa', distance: 'full', date: '2027-01-03', createdAt: '2026-10-25T10:00:00' });
    const now = phaseFor('2026-10-26', [full]);
    expect(now.phase).toBe('base');
    expect(now.warnings.join(' ')).toMatch(/plan de supervivencia/);
    expect(now.warnings.join(' ')).toMatch(/distancia completa/);
    const weeks = Array.from({ length: 10 }, (_, i) => phaseFor(addDays('2026-10-26', 7 * i), [full]));
    expect(weeks.map((w) => w.phase)).not.toContain('build');
    expect(weeks[weeks.length - 1]?.phase).toBe('race_week');
    expect(weeks[weeks.length - 2]?.phase).toBe('taper');
    const sprint = makeRace({ id: 's', distance: 'sprint', date: '2026-12-13', createdAt: '2026-10-25T10:00:00' });
    expect(phaseFor('2026-10-26', [sprint]).warnings.join(' ')).not.toMatch(/distancia completa/);
  });

  test('the layout is anchored on when the A race was added, so it is stable week to week', () => {
    const olympic = makeRace({ id: 'o', distance: 'olympic', date: '2027-03-14', createdAt: '2026-10-25T10:00:00' });
    const order: Record<string, number> = { prep: 0, base: 1, build: 2, peak: 3, taper: 4, race_week: 5 };
    const weeks = Array.from({ length: 20 }, (_, i) => phaseFor(addDays('2026-10-26', 7 * i), [olympic]));
    const ranks = weeks.map((w) => order[w.phase] ?? -1);
    for (let i = 1; i < ranks.length; i += 1) expect(ranks[i] ?? 0).toBeGreaterThanOrEqual(ranks[i - 1] ?? 0);
    expect(weeks.every((w) => w.warnings.length === 0)).toBe(true);
    // Recomputing later gives the same answer for the same week (no shift with the passing weeks).
    expect(phaseFor('2027-01-11', [olympic])).toEqual(weeks[11]);
  });

  test('every base/build subphase ends with a recovery week; never more than 3 load weeks in a row (ENG-18)', () => {
    const half = makeRace({ id: 'h', distance: 'half', date: '2027-04-11', createdAt: '2026-01-01T00:00:00' });
    const weeks = Array.from({ length: 30 }, (_, i) => phaseFor(addDays('2027-04-05', -7 * i), [half])).reverse();
    let run = 0;
    weeks.forEach((w, i) => {
      const next = weeks[i + 1];
      const closesSubphase = next && w.subphase !== next.subphase && (w.phase === 'base' || w.subphase === 'build1');
      if (closesSubphase && w.subphase !== 'maintenance') expect(w.isRecoveryWeek).toBe(true);
      if (w.phase === 'base' || w.phase === 'build') {
        run = w.isRecoveryWeek ? 0 : run + 1;
        expect(run).toBeLessThanOrEqual(3);
      }
    });
    // base3 → build1 boundary (the week before the first build week) is a recovery week.
    const firstBuild = weeks.findIndex((w) => w.phase === 'build');
    expect(weeks[firstBuild - 1]?.isRecoveryWeek).toBe(true);
  });

  test('maintenance volume never exceeds the first base week of the plan (ENG-18)', () => {
    const far = makeRace({ id: 'far', distance: 'half', date: '2027-10-03', createdAt: '2026-10-25T10:00:00' });
    const weeks = Array.from({ length: 40 }, (_, i) => phaseFor(addDays('2026-10-26', 7 * i), [far]));
    const firstBase = weeks.findIndex((w) => w.subphase === 'base1');
    expect(firstBase).toBeGreaterThan(0);
    const maintenance = weeks.slice(0, firstBase);
    expect(maintenance.every((w) => w.subphase === 'maintenance')).toBe(true);
    for (const m of maintenance) expect(m.volumeFactor).toBeLessThanOrEqual(weeks[firstBase]?.volumeFactor ?? 0);
  });

  test('two A races close together are compressed and warned', () => {
    const first = makeRace({ id: 'o', date: '2027-03-14', distance: 'olympic', priority: 'A' });
    const full = makeRace({ id: 'f', date: '2027-04-25', distance: 'full', priority: 'A' });
    const p = phaseFor('2027-04-05', [first, full]);
    expect(p.targetRace?.id).toBe('f');
    expect(p.warnings.join(' ')).toMatch(/muy seguidas/);
    const between = phaseFor('2027-03-29', [first, full]);
    expect(['build', 'peak', 'taper', 'base']).toContain(between.phase);
  });
});
