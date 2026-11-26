/**
 * Realistic athletes (automatic availability, a month of history): habitual
 * volume, the long session under a tight calendar, exam weeks, beginner
 * intensity and the long run on the weekend.
 */
import { allocateSessions } from '../allocation';
import { addDays, weekdayOf } from '../dates';
import { phaseFor } from '../periodization';
import { planWeek, type PlannerInput } from '../planner';
import { rampCapMinutes } from '../plannerSupport';
import { buildSeason, habitualFloorMinutes, habitualWeeklyMinutes, HABITUAL_RECOVERY_SHARE } from '../season';
import { isQualitySpec, specClass } from '../sessions';
import type { Availability, BusyBlock, LifeEvent, Workout } from '../types';
import { makeBusy, makeEvent, makeProfile, makeRace, makeWorkout } from './fixtures';

const AUTO: Availability = { mode: 'auto', weeklyHoursTarget: 0, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };
/** Base weeks towards a 70.3 in June: 2026-11-30 and 2026-12-07 are load weeks, 2026-12-14 the descarga. */
const LOAD_WEEK = '2026-11-30';
const RECOVERY_WEEK = '2026-12-14';
const HALF = makeRace({ date: '2027-06-13', distance: 'half' });

/** Four weeks of completed training before `weekStart`, about `weekly` minutes each. */
function history(weekStart: string, weekly: number): Workout[] {
  const out: Workout[] = [];
  for (let w = 4; w >= 1; w -= 1) {
    const monday = addDays(weekStart, -7 * w);
    const run = Math.round(weekly * 0.3);
    const bike = Math.round(weekly * 0.5);
    const swim = weekly - run - bike;
    const items: [number, Workout['sport'], number, number | null][] = [
      [1, 'swim', Math.round(swim / 2), 2000],
      [3, 'swim', swim - Math.round(swim / 2), 2000],
      [1, 'run', Math.round(run * 0.35), Math.round(run * 0.35 * 180)],
      [3, 'run', Math.round(run * 0.25), Math.round(run * 0.25 * 180)],
      [6, 'run', run - Math.round(run * 0.6), (run - Math.round(run * 0.6)) * 170],
      [2, 'bike', Math.round(bike * 0.3), null],
      [5, 'bike', bike - Math.round(bike * 0.3), null],
    ];
    for (const [day, sport, durationMin, distanceM] of items) {
      out.push(makeWorkout({ date: addDays(monday, day), sport, durationMin, distanceM, status: 'completed', completed: { durationMin, distanceM: distanceM ?? undefined } }));
    }
  }
  return out;
}

function athlete(overrides: Partial<PlannerInput> = {}, weekly = 480): PlannerInput {
  const weekStart = overrides.weekStart ?? LOAD_WEEK;
  return {
    weekStart,
    profile: makeProfile({ availability: AUTO }),
    races: [HALF],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    recentWeeklyMinutes: [weekly, weekly, weekly, weekly],
    history: history(weekStart, weekly),
    ...overrides,
  };
}

function workBlocks(monday: string): BusyBlock[] {
  return [0, 1, 2, 3, 4].map((i) => makeBusy(`${addDays(monday, i)}T08:00:00`, `${addDays(monday, i)}T17:30:00`));
}

describe('problem 1: automatic volume follows the habitual volume', () => {
  test('habitual minutes and the floor', () => {
    expect(habitualWeeklyMinutes([480, 500, 460])).toBeCloseTo(480);
    expect(habitualWeeklyMinutes([480])).toBeNull();
    expect(habitualWeeklyMinutes([0, 0])).toBeNull();
    expect(habitualFloorMinutes({ phase: 'base', isRecoveryWeek: false }, 12, [480, 480])).toBe(480);
    expect(habitualFloorMinutes({ phase: 'base', isRecoveryWeek: true }, 12, [480, 480])).toBe(480 * HABITUAL_RECOVERY_SHARE);
    // Capped by the automatic peak hours (12 h for an intermediate 70.3).
    expect(habitualFloorMinutes({ phase: 'build', isRecoveryWeek: false }, 12, [900, 900])).toBe(720);
    expect(habitualFloorMinutes({ phase: 'taper', isRecoveryWeek: false }, 12, [480, 480])).toBe(0);
    expect(habitualFloorMinutes({ phase: 'base', isRecoveryWeek: false }, 12, [480, 480], { kind: 'rest', targetMinutes: null })).toBe(0);
    expect(habitualFloorMinutes({ phase: 'base', isRecoveryWeek: false }, 12, [480, 480], { kind: 'load', targetMinutes: 300 })).toBe(0);
  });

  test('an intermediate 70.3 athlete on 8 h a week gets at least 8 h in a base load week', () => {
    const phase = phaseFor(LOAD_WEEK, [HALF], { level: 'intermediate' });
    expect(phase.phase).toBe('base');
    expect(phase.isRecoveryWeek).toBe(false);
    // The periodization alone asks for less than the athlete already trains.
    expect(12 * 60 * phase.volumeFactor).toBeLessThan(480);
    const result = planWeek(athlete());
    expect(result.targetMinutes).toBeGreaterThanOrEqual(480);
    expect(result.placed.reduce((s, p) => s + p.spec.durationMin, 0)).toBeGreaterThanOrEqual(460);
  });

  test('a descarga keeps at least 60 % of the habitual volume', () => {
    const result = planWeek(athlete({ weekStart: RECOVERY_WEEK }));
    expect(result.phase.isRecoveryWeek).toBe(true);
    expect(result.targetMinutes).toBeGreaterThanOrEqual(Math.floor(480 * HABITUAL_RECOVERY_SHARE));
    expect(result.targetMinutes).toBeLessThan(480);
  });

  test('manual availability keeps its own hours', () => {
    const manual: Availability = { ...AUTO, mode: 'manual', weeklyHoursTarget: 5, restDay: 0 };
    const result = planWeek(athlete({ profile: makeProfile({ availability: manual }) }));
    expect(result.targetMinutes).toBeLessThan(5 * 60);
  });

  test('the ramp cap still applies on top of the floor', () => {
    const result = planWeek(athlete({ recentWeeklyMinutes: [200, 200, 200, 200], fitnessWeeklyMinutes: [700, 700, 700, 700] }));
    const ramp = rampCapMinutes({ recentWeeklyMinutes: [200, 200, 200, 200], level: 'intermediate', lifeStress: false }) ?? 0;
    expect(result.targetMinutes).toBeLessThanOrEqual(ramp);
  });

  test('Plan → General shows the same floor in automatic mode', () => {
    const season = buildSeason({ today: LOAD_WEEK, races: [HALF], level: 'intermediate', weeklyHoursTarget: null, recentWeeklyMinutes: [480, 480, 480, 480] });
    const plain = buildSeason({ today: LOAD_WEEK, races: [HALF], level: 'intermediate', weeklyHoursTarget: null });
    expect(season.weeks[0]?.targetMinutes).toBe(480);
    expect(plain.weeks[0]?.targetMinutes ?? 0).toBeLessThan(480);
    const recovery = season.weeks.find((w) => w.kind === 'recovery');
    expect(recovery?.targetMinutes ?? 0).toBeGreaterThanOrEqual(285);
  });
});

describe('problem 2: the long session survives a short budget (half / full distance)', () => {
  test('a beginner Ironman descarga with work blocks and a Saturday padel match still rides long on the weekend', () => {
    const padel: LifeEvent = makeEvent({ kind: 'padel', title: 'Pádel', startDate: addDays(LOAD_WEEK, 5), startTime: '09:00', durationMin: 90, severity: 2 });
    const result = planWeek(
      athlete(
        {
          profile: makeProfile({ availability: AUTO, level: 'beginner' }),
          races: [makeRace({ date: '2027-06-13', distance: 'full' })],
          busyBlocks: workBlocks(LOAD_WEEK),
          lifeEvents: [padel],
        },
        300,
      ),
    );
    const long = result.placed.find((p) => p.spec.code === 'BK_LONG' || p.spec.code === 'BRICK');
    expect(long).toBeDefined();
    expect([5, 6]).toContain(weekdayOf(long?.date ?? LOAD_WEEK));
    // No two short easy rides instead of the long one.
    expect(result.placed.filter((p) => p.spec.code === 'BK_END').length).toBeLessThanOrEqual(1);
  });

  test('allocation: few bike minutes in a 70.3 base week give one long ride, not two short ones', () => {
    const phase = phaseFor(LOAD_WEEK, [HALF], { level: 'intermediate' });
    const specs = allocateSessions({
      phase,
      distance: 'half',
      kind: 'tri_long',
      minutes: 180,
      sports: ['swim', 'bike', 'run'],
      qualityCut: 0,
      qualityCap: null,
      blockedAllWeek: [],
      substitutes: {},
      easyOnlyAllWeek: [],
      caps: { runLongMax: null, bikeLongMax: null },
    });
    expect(specs.some((s) => s.code === 'BK_LONG')).toBe(true);
  });
});

describe('problem 3: exam weeks', () => {
  const exam = (monday: string, severity: LifeEvent['severity'] = 2): LifeEvent =>
    makeEvent({ id: 'exam', kind: 'exam', title: 'Exámenes', startDate: addDays(monday, 1), endDate: addDays(monday, 3), startTime: null, durationMin: null, severity });

  test('a load week loses 30 % and keeps only the essentials', () => {
    const calm = planWeek(athlete());
    const result = planWeek(athlete({ lifeEvents: [exam(LOAD_WEEK)] }));
    expect(result.targetMinutes).toBeLessThanOrEqual(Math.round(calm.targetMinutes * 0.7) + 1);
    expect(result.targetMinutes).toBeGreaterThanOrEqual(Math.round(calm.targetMinutes * 0.7) - 1);
    const quality = result.placed.filter((p) => isQualitySpec(p.spec) || p.spec.code === 'SW_CSS');
    expect(quality.length).toBeLessThanOrEqual(1);
    const examDays = [1, 2, 3].map((d) => addDays(LOAD_WEEK, d));
    for (const p of result.placed) {
      if (examDays.includes(p.date)) {
        expect(p.spec.durationMin).toBeLessThanOrEqual(45);
        expect(isQualitySpec(p.spec) || specClass(p.spec) === 'LONG').toBe(false);
      }
      // No quality the day before the first exam either.
      if (p.date === LOAD_WEEK) expect(isQualitySpec(p.spec)).toBe(false);
    }
    expect(result.placed.some((p) => p.spec.code === 'ST_HEAVY')).toBe(false);
    expect(result.summary).toMatch(/Semana de exámenes: \d+h( \d+')? en vez de 8h, sin series el día antes ni el día del examen\./);
    expect(result.summary).not.toMatch(/dejamos solo lo esencial/);
  });

  test('severity 3 cuts 40 %', () => {
    const calm = planWeek(athlete());
    const result = planWeek(athlete({ lifeEvents: [exam(LOAD_WEEK, 3)] }));
    expect(result.targetMinutes).toBeLessThanOrEqual(Math.round(calm.targetMinutes * 0.6) + 1);
  });

  test('a descarga is never lifted by the stress cadence and is not cut twice', () => {
    const descarga = planWeek(athlete({ weekStart: RECOVERY_WEEK }));
    const result = planWeek(athlete({ weekStart: RECOVERY_WEEK, lifeEvents: [exam(RECOVERY_WEEK)] }));
    expect(descarga.phase.isRecoveryWeek).toBe(true);
    expect(result.phase.isRecoveryWeek).toBe(true);
    expect(result.targetMinutes).toBeLessThanOrEqual(descarga.targetMinutes);
    expect(result.summary).toMatch(/Semana de exámenes: coincide con la descarga/);
  });

  test('stress slows the ramp: events and a check-in stress of 4 or more', () => {
    const recent = [300, 300, 300, 300];
    const calm = rampCapMinutes({ recentWeeklyMinutes: recent, level: 'intermediate', lifeStress: false }) ?? 0;
    const stressed = rampCapMinutes({ recentWeeklyMinutes: recent, level: 'intermediate', lifeStress: true }) ?? 0;
    expect(stressed).toBeLessThan(calm);
    const input = athlete({ recentWeeklyMinutes: recent, fitnessWeeklyMinutes: [700, 700, 700, 700] });
    expect(planWeek(input).targetMinutes).toBeLessThanOrEqual(calm);
    expect(planWeek({ ...input, checkinStress: 4 }).targetMinutes).toBeLessThanOrEqual(stressed);
    expect(planWeek({ ...input, checkinStress: 3 }).targetMinutes).toBeGreaterThan(stressed);
    const work = makeEvent({ kind: 'work', title: 'Cierre', startDate: LOAD_WEEK, endDate: addDays(LOAD_WEEK, 4), severity: 2, durationMin: null });
    expect(planWeek({ ...input, lifeEvents: [work] }).targetMinutes).toBeLessThanOrEqual(stressed);
  });
});

describe('problem 4: beginner intensity', () => {
  test('a beginner olympic athlete on 3 h gets one quality session at most and no heavy strength', () => {
    const weekStart = '2026-12-07';
    const result = planWeek(
      athlete(
        {
          weekStart,
          profile: makeProfile({ availability: AUTO, level: 'beginner' }),
          races: [makeRace({ date: '2027-06-13', distance: 'olympic' })],
          history: history(weekStart, 180),
        },
        180,
      ),
    );
    expect(result.phase.isRecoveryWeek).toBe(false);
    const quality = result.placed.filter((p) => isQualitySpec(p.spec) || p.spec.code === 'SW_CSS');
    expect(quality.length).toBeLessThanOrEqual(1);
    expect(result.placed.some((p) => p.spec.code === 'ST_HEAVY')).toBe(false);
    // The quality session is never the only one of its sport.
    for (const q of quality) {
      const sameSport = result.placed.filter((p) => p.spec.code.slice(0, 2) === q.spec.code.slice(0, 2));
      expect(sameSport.length).toBeGreaterThan(1);
    }
  });
});

describe('problem 5: the long run goes on the weekend in automatic mode', () => {
  test('maintenance without a race: long run and long ride on Saturday and Sunday', () => {
    const result = planWeek(athlete({ races: [] }));
    const longs = result.placed.filter((p) => specClass(p.spec) === 'LONG');
    expect(longs.length).toBeGreaterThanOrEqual(2);
    for (const p of longs) expect([5, 6]).toContain(weekdayOf(p.date));
  });
});
