/** Regression tests for planner rule fixes (review findings ENG-1, 2, 5, 7, 8, 13, 14, 15, 17). */
import { addDays, daysInRange, timeToMinutes } from '../dates';
import { workoutHardPoints } from '../hardness';
import { planWeek, type PlannerInput } from '../planner';
import { specHardPoints } from '../sessions';
import type { PlanChange, TrainingWindow, WorkoutDraft } from '../types';
import { makeBusy, makeEvent, makeProfile, makeRace, makeWorkout, NEXT_MONDAY } from './fixtures';

function adds(changes: PlanChange[]): WorkoutDraft[] {
  return changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return { weekStart: NEXT_MONDAY, profile: makeProfile(), races: [makeRace()], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [], ...overrides };
}

function withAvailability(patch: Partial<ReturnType<typeof makeProfile>['availability']>, overrides: Parameters<typeof makeProfile>[0] = {}) {
  const base = makeProfile(overrides);
  return { ...base, availability: { ...base.availability, ...patch } };
}

/** Olympic A race planned long ago: the week of 2 Nov is a build load week with a brick on Saturday. */
const olympicBuild = makeRace({ id: 'oly', name: 'Olímpico de Madrid', distance: 'olympic', date: '2026-12-13', createdAt: '2026-05-01T10:00:00' });
const BUILD_WEEK = '2026-11-02';

describe('ENG-1 injuries also restrict bricks', () => {
  test('amber or green knee: no brick on the injured days', () => {
    const control = adds(planWeek(baseInput({ races: [olympicBuild], weekStart: BUILD_WEEK })).changes);
    expect(control.some((d) => d.sport === 'brick' && d.date >= '2026-11-06')).toBe(true);
    for (const severity of [1, 2] as const) {
      const knee = makeEvent({ id: `knee${severity}`, kind: 'injury', severity, bodyArea: 'knee', title: 'Rodilla', startDate: '2026-11-06', endDate: '2026-11-08' });
      const drafts = adds(planWeek(baseInput({ races: [olympicBuild], lifeEvents: [knee], weekStart: BUILD_WEEK })).changes);
      const injured = drafts.filter((d) => d.date >= '2026-11-06');
      expect(injured.some((d) => d.sport === 'brick')).toBe(false);
      if (severity === 2) expect(injured.some((d) => d.sport === 'run')).toBe(false);
    }
  });
});

describe('ENG-2 past events still shape the week, cardiac blocks expire', () => {
  test('cardiac symptoms that ended before the week still block it', () => {
    const cardiac = makeEvent({ kind: 'illness', severity: 1, title: 'Palpitaciones y mareo', startDate: '2026-10-23', endDate: '2026-10-24' });
    expect(adds(planWeek(baseInput({ lifeEvents: [cardiac] })).changes)).toEqual([]);
  });

  test('an old cardiac event does not block training forever; the medical all-clear ends it', () => {
    const old = makeEvent({ kind: 'illness', severity: 1, title: 'Palpitaciones', startDate: '2026-09-01', endDate: '2026-09-02' });
    expect(adds(planWeek(baseInput({ lifeEvents: [old] })).changes).length).toBeGreaterThan(3);
    const cleared = makeEvent({ kind: 'illness', severity: 1, title: 'Palpitaciones', notes: 'Cardiólogo ok, me han dado el alta médica', startDate: '2026-10-23', endDate: '2026-10-24' });
    const drafts = adds(planWeek(baseInput({ lifeEvents: [cleared] })).changes);
    expect(drafts.length).toBeGreaterThan(0);
    const returnDays = drafts.filter((d) => d.date <= '2026-10-31');
    expect(returnDays.every((d) => d.intensity === 'endurance' || d.intensity === 'recovery')).toBe(true);
  });

  test('an illness that ended last week keeps the progressive return', () => {
    const fever = makeEvent({ kind: 'illness', severity: 3, title: 'Fiebre', startDate: '2026-10-22', endDate: '2026-10-25' });
    const drafts = adds(planWeek(baseInput({ lifeEvents: [fever] })).changes);
    expect(drafts.every((d) => d.date >= '2026-10-27')).toBe(true);
    expect(drafts.every((d) => d.intensity === 'endurance' || d.intensity === 'recovery')).toBe(true);
  });
});

describe('ENG-5 race on the rest day', () => {
  test('Sunday rest + Sunday A race: the race is planned and the rest moves', () => {
    const race = makeRace({ id: 'o', name: 'Olímpico', distance: 'olympic', date: '2026-11-01', createdAt: '2026-05-01T10:00:00' });
    const r = planWeek(baseInput({ profile: withAvailability({ restDay: 6 }), races: [race] }));
    const drafts = adds(r.changes);
    expect(drafts.find((d) => d.date === '2026-11-01' && d.intensity === 'race')?.title).toMatch(/Carrera: Olímpico/);
    expect(r.summary).not.toMatch(/No he encontrado hueco para: Carrera/);
    expect(r.summary).toMatch(/de descanso: lo cambio de día/);
    expect(r.summary).not.toMatch(/Domingo de descanso/);
  });

  test('Monday rest + Monday race: the race is planned', () => {
    const race = makeRace({ id: 'h', name: 'Media de Getafe', distance: 'run_half', date: NEXT_MONDAY, createdAt: '2026-05-01T10:00:00' });
    const r = planWeek(baseInput({ races: [race] }));
    expect(adds(r.changes).some((d) => d.date === NEXT_MONDAY && d.intensity === 'race')).toBe(true);
    expect(r.summary).not.toMatch(/No he encontrado hueco para: Carrera/);
  });
});

describe('ENG-7 B-race mini-taper and L03', () => {
  /** Half A race added months ago: the week of 22 Mar 2027 is a build load week. */
  const halfA = makeRace({ createdAt: '2026-01-01T10:00:00' });
  const b = makeRace({ id: 'b', name: 'Olímpico B', priority: 'B', distance: 'olympic', date: '2027-03-27' });
  const profile = withAvailability({ weeklyHoursTarget: 10 });

  const pointsOn = (r: ReturnType<typeof planWeek>, date: string) => r.placed.filter((p) => p.date === date).reduce((s, p) => s + specHardPoints(p.spec), 0);

  test('no hard day in the 48 h before a B race and nothing hard the 2 days after', () => {
    const r = planWeek(baseInput({ profile, races: [halfA, b], weekStart: '2027-03-22' }));
    const drafts = adds(r.changes);
    expect(drafts.some((d) => d.date === '2027-03-27' && d.intensity === 'race')).toBe(true);
    expect(['2027-03-22', '2027-03-23', '2027-03-24'].some((d) => pointsOn(r, d) >= 1)).toBe(true);
    for (const date of ['2027-03-25', '2027-03-26']) expect(pointsOn(r, date)).toBeLessThan(1);
    expect(drafts.filter((d) => d.date === '2027-03-26').every((d) => !['tempo', 'threshold', 'vo2'].includes(d.intensity))).toBe(true);
    expect(pointsOn(r, '2027-03-28')).toBe(0);
  });

  test('L03: after a day with ≥ 2 hard points the next day has none', () => {
    const control = planWeek(baseInput({ profile, races: [halfA], weekStart: '2027-03-22' }));
    expect(pointsOn(control, '2027-03-28')).toBeGreaterThan(0);
    const existing = [
      makeWorkout({ id: 'sat-brick', date: '2027-03-27', sport: 'brick', intensity: 'endurance', durationMin: 150, startTime: '08:00' }),
      makeWorkout({ id: 'sat-swim', date: '2027-03-27', sport: 'swim', intensity: 'threshold', durationMin: 45, startTime: '18:00' }),
    ];
    const r = planWeek(baseInput({ profile, races: [halfA], existing, weekStart: '2027-03-22' }));
    expect(pointsOn(r, '2027-03-28')).toBe(0);
  });
});

describe('ENG-8 the athlete’s own rest workouts', () => {
  test('a rest workout on Wednesday keeps Wednesday free and becomes the rest day', () => {
    const rest = makeWorkout({ id: 'rest', date: '2026-10-28', sport: 'rest', title: 'Descanso', durationMin: 0 });
    const r = planWeek(baseInput({ profile: withAvailability({ restDay: null }), existing: [rest] }));
    expect(adds(r.changes).some((d) => d.date === '2026-10-28')).toBe(false);
    expect(r.summary).toMatch(/Miércoles de descanso/);
  });

  test('with an explicit rest day, an extra rest workout is respected too', () => {
    const rest = makeWorkout({ id: 'rest', date: '2026-10-29', sport: 'rest', title: 'Descanso', durationMin: 0 });
    const drafts = adds(planWeek(baseInput({ existing: [rest] })).changes);
    expect(drafts.some((d) => d.date === '2026-10-29' || d.date === NEXT_MONDAY)).toBe(false);
  });
});

describe('ENG-13 L05 above 12 h and bricks vs bike/run', () => {
  test('no rest day at 14 h: one easy day of ≤ 60 min without hard points', () => {
    const profile = withAvailability({ restDay: null, weeklyHoursTarget: 14 });
    const r = planWeek(baseInput({ profile, weekStart: '2027-03-22' }));
    const drafts = adds(r.changes);
    const days = daysInRange({ from: '2027-03-22', to: '2027-03-28' });
    const easy = days.filter((d) => {
      const list = drafts.filter((x) => x.date === d);
      return list.reduce((s, x) => s + x.durationMin, 0) <= 60 && list.every((x) => workoutHardPoints(x) === 0);
    });
    expect(easy.length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/suave: como mucho 60'/);
  });

  test('a brick never shares the day with another ride or run', () => {
    const windows: TrainingWindow[] = [
      ...[0, 1, 2, 3, 4].map((weekday) => ({ weekday: weekday as 0, start: '18:00', end: '19:15' })),
      { weekday: 5, start: '07:00', end: '14:00' },
      { weekday: 6, start: '07:00', end: '14:00' },
    ];
    for (const hours of [10, 14]) {
      const profile = withAvailability({ weeklyHoursTarget: hours, restDay: null, windows });
      const drafts = adds(planWeek(baseInput({ profile, weekStart: '2027-03-22' })).changes);
      for (const brick of drafts.filter((d) => d.sport === 'brick')) {
        expect(drafts.some((d) => d.date === brick.date && (d.sport === 'bike' || d.sport === 'run'))).toBe(false);
      }
    }
  });
});

describe('ENG-14 planning today never proposes past times', () => {
  const windows: TrainingWindow[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday: weekday as 0, start: '07:00', end: '09:00' }));
  const profile = withAvailability({ windows, restDay: 0 });

  const sunday = (nowMinutes?: number) =>
    adds(planWeek(baseInput({ profile, weekStart: '2026-10-19', today: '2026-10-25', nowMinutes })).changes).filter((d) => d.date === '2026-10-25');

  test('at 21:00 on Sunday nothing is added for that morning', () => {
    expect(sunday().length).toBeGreaterThan(0);
    expect(sunday(21 * 60)).toEqual([]);
  });

  test('at 07:30 the rest of the window is used, never before now + 30 min', () => {
    const later = sunday(7 * 60 + 30);
    expect(later.length).toBeGreaterThan(0);
    for (const d of later) expect(timeToMinutes(d.startTime ?? '00:00')).toBeGreaterThanOrEqual(8 * 60);
  });
});

describe('ENG-15 race early next week', () => {
  const mondayRace = makeRace({ id: 'h', name: 'Medio de Sevilla', distance: 'half', date: NEXT_MONDAY, createdAt: '2026-04-01T10:00:00' });

  test('the week before gets the activation (D−1), easy swim (D−2) and spark (D−3/D−4)', () => {
    const r = planWeek(baseInput({ races: [mondayRace], weekStart: '2026-10-19', today: '2026-10-19' }));
    const drafts = adds(r.changes);
    expect(drafts.find((d) => d.date === '2026-10-25')?.title).toMatch(/Activación/);
    expect(drafts.some((d) => d.date === '2026-10-24' && d.sport === 'swim')).toBe(true);
    expect(drafts.some((d) => (d.date === '2026-10-22' || d.date === '2026-10-23') && d.sport === 'brick')).toBe(true);
    // D−2 (Saturday): rest or an easy swim; D−1: only the activation (§5.4).
    expect(drafts.filter((d) => d.date === '2026-10-24').every((d) => d.sport === 'swim' && workoutHardPoints(d) === 0)).toBe(true);
    expect(drafts.filter((d) => d.date === '2026-10-25').every((d) => /Activación/.test(d.title))).toBe(true);
  });

  test('the race week does not report pre-race sessions of the previous week as dropped', () => {
    const r = planWeek(baseInput({ races: [mondayRace] }));
    expect(adds(r.changes).some((d) => d.date === NEXT_MONDAY && d.intensity === 'race')).toBe(true);
    expect(r.summary).not.toMatch(/Activación|Natación técnica|Brick/);
  });
});

describe('ENG-17 summary when nothing fits', () => {
  test('says no free slot was found instead of “nothing to add”', () => {
    const busy = daysInRange({ from: NEXT_MONDAY, to: addDays(NEXT_MONDAY, 6) }).map((d) => makeBusy(`${d}T00:00:00`, `${d}T23:59:00`, `busy-${d}`));
    const r = planWeek(baseInput({ busyBlocks: busy }));
    expect(adds(r.changes)).toEqual([]);
    expect(r.summary).toMatch(/No he encontrado hueco libre para añadir sesiones/);
    expect(r.summary).not.toMatch(/No hace falta añadir nada más/);
  });

  test('keeps “nothing to add” when nothing was needed', () => {
    const r = planWeek(baseInput({ profile: withAvailability({ weeklyHoursTarget: 0 }) }));
    expect(r.changes).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.summary).toMatch(/No hace falta añadir nada más/);
  });
});
