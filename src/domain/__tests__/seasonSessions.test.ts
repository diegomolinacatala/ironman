/** Plan → General: key sessions and minutes per sport of each season week. */
import { addDays } from '../dates';
import { phaseFor } from '../periodization';
import { pinnedRaceSessions } from '../plannerSupport';
import { buildSeason, type SeasonWeek } from '../season';
import { seasonWeekDetail, type SeasonWeekDetail } from '../seasonSessions';
import type { Profile, Race, WeekPlan } from '../types';
import { makeProfile, makeRace } from './fixtures';

const TODAY = '2026-11-09'; // Monday
const SEASON_SPORTS = ['swim', 'bike', 'run', 'brick', 'strength'];

interface Row {
  week: SeasonWeek;
  detail: SeasonWeekDetail;
}

function plan(weekStart: string, kind: WeekPlan['kind'], extra: Partial<WeekPlan> = {}): WeekPlan {
  return { weekStart, kind, targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-09T10:00:00Z', ...extra };
}

function withHours(hours: number, overrides: Partial<Profile> = {}): Profile {
  const base = makeProfile(overrides);
  return { ...base, availability: { ...base.availability, weeklyHoursTarget: hours } };
}

function rowsFor(races: Race[], profile: Profile, weekPlans: WeekPlan[] = [], horizonWeeks?: number): Row[] {
  const season = buildSeason({ today: TODAY, races, level: profile.level, weeklyHoursTarget: profile.availability.weeklyHoursTarget, weekPlans, horizonWeeks });
  return season.weeks.map((week) => ({ week, detail: seasonWeekDetail(week, { profile, races }) }));
}

function at(rows: readonly Row[], weekStart: string): Row {
  const row = rows.find((r) => r.week.weekStart === weekStart);
  if (!row) throw new Error(`no row for ${weekStart}`);
  return row;
}

function total(detail: SeasonWeekDetail): number {
  return Object.values(detail.sportMinutes).reduce<number>((sum, m) => sum + (m ?? 0), 0);
}

function expectWellFormed(rows: readonly Row[]): void {
  for (const { detail } of rows) {
    expect(detail.keySessions.length).toBeLessThanOrEqual(3);
    expect(new Set(detail.keySessions).size).toBe(detail.keySessions.length);
    for (const name of detail.keySessions) expect(name).toMatch(/^Carrera: .+|\d/);
    for (const [sport, minutes] of Object.entries(detail.sportMinutes)) {
      expect(SEASON_SPORTS).toContain(sport);
      expect(minutes).toBeGreaterThan(0);
      expect((minutes ?? 0) % 5).toBe(0);
    }
  }
}

describe('seasonWeekDetail — Medio de Valencia in 4 weeks (8 h)', () => {
  const race = makeRace({ id: 'a', name: 'Medio de Valencia', date: '2026-12-06', distance: 'half', createdAt: '2026-11-09T10:00:00' });
  const rows = rowsFor([race], withHours(8));

  test('one detail per week: up to 3 named key sessions and minutes per sport', () => {
    expect(rows.map((r) => r.week.kind)).toEqual(['load', 'load', 'taper', 'race']);
    expectWellFormed(rows);
  });

  test('load weeks: the long ride leads, with quality sets, close to the target hours', () => {
    for (const { week, detail } of rows.slice(0, 2)) {
      expect(detail.keySessions[0]).toMatch(/^Bici larga \d/);
      expect(detail.keySessions.some((k) => /\d+×\d/.test(k))).toBe(true);
      expect(Math.abs(total(detail) - week.targetMinutes)).toBeLessThanOrEqual(week.targetMinutes * 0.15);
      expect(detail.sportMinutes.bike ?? 0).toBeGreaterThan(detail.sportMinutes.run ?? 0);
    }
  });

  test('afinamiento keeps the intensity with less volume', () => {
    const load = at(rows, '2026-11-16');
    const taper = at(rows, '2026-11-23');
    expect(total(taper.detail)).toBeLessThan(total(load.detail));
    expect(taper.detail.keySessions.some((k) => /umbral/.test(k))).toBe(true);
  });

  test('race week: the race first, then the pre-race brick and the activation; the race is not training time', () => {
    const { detail } = at(rows, '2026-11-30');
    expect(detail.keySessions[0]).toBe('Carrera: Medio de Valencia');
    expect(detail.keySessions[1]).toMatch(/^Brick \d+' \+ \d+'$/);
    expect(detail.keySessions[2]).toBe("Activación 25'");
    expect(detail.sportMinutes.brick).toBe(45);
    expect(total(detail)).toBeLessThan(330);
  });
});

describe('seasonWeekDetail — 12-week olympic plan', () => {
  const race = makeRace({ id: 'o', name: 'Olímpico de Sevilla', date: '2027-01-31', distance: 'olympic', createdAt: '2026-11-09T10:00:00' });
  const rows = rowsFor([race], withHours(8));

  test('twelve well-formed weeks, base then build', () => {
    expect(rows).toHaveLength(12);
    expectWellFormed(rows);
    expect(rows.some((r) => r.week.phase === 'base')).toBe(true);
    expect(rows.some((r) => r.week.phase === 'build')).toBe(true);
  });

  test('bricks only in the build load weeks', () => {
    for (const { week, detail } of rows) {
      if (week.phase === 'build' && week.kind === 'load') expect(detail.sportMinutes.brick ?? 0).toBeGreaterThan(0);
      if (week.phase === 'base') expect(detail.sportMinutes.brick).toBeUndefined();
    }
  });

  test('each descarga is lighter than the load week before it', () => {
    const descargas = rows.filter((r, i) => r.week.kind === 'recovery' && rows[i - 1]?.week.kind === 'load');
    expect(descargas.length).toBeGreaterThanOrEqual(2);
    for (const row of descargas) {
      const before = rows[rows.indexOf(row) - 1];
      expect(total(row.detail)).toBeLessThan(total(before!.detail));
    }
  });

  test('load weeks name a quality set, a brick or a long session', () => {
    for (const { detail } of rows.filter((r) => r.week.kind === 'load')) {
      expect(detail.keySessions.some((k) => /×|larga|Brick/.test(k))).toBe(true);
    }
  });

  test('the race week leads with the race', () => {
    expect(at(rows, '2027-01-25').detail.keySessions[0]).toBe('Carrera: Olímpico de Sevilla');
  });
});

describe("seasonWeekDetail — the athlete's adjustments", () => {
  const race = makeRace({ id: 'o', name: 'Olímpico de Sevilla', date: '2027-01-31', distance: 'olympic', createdAt: '2026-11-09T10:00:00' });
  const profile = withHours(8);
  const base = rowsFor([race], profile);
  const adjusted = rowsFor([race], profile, [plan('2026-11-16', 'recovery'), plan('2026-11-23', 'rest'), plan('2026-11-30', 'push')]);

  test('a descarga lowers the week and keeps fewer key sessions', () => {
    const before = at(base, '2026-11-16');
    const after = at(adjusted, '2026-11-16');
    expect(before.week.kind).toBe('load');
    expect(after.week.kind).toBe('recovery');
    expect(total(after.detail)).toBeLessThan(total(before.detail) * 0.75);
    expect(after.detail.keySessions.length).toBeLessThan(before.detail.keySessions.length);
  });

  test('semana libre: no key sessions and only light minutes', () => {
    const free = at(adjusted, '2026-11-23');
    expect(free.week.kind).toBe('rest');
    expect(free.detail.keySessions).toEqual([]);
    expect(free.detail.sportMinutes.brick).toBeUndefined();
    expect(total(free.detail)).toBeGreaterThan(0);
    expect(total(free.detail)).toBeLessThan(total(at(base, '2026-11-23').detail) * 0.5);
  });

  test('más volumen on a scheduled descarga turns it into a bigger week', () => {
    const before = at(base, '2026-11-30');
    const after = at(adjusted, '2026-11-30');
    expect(before.week.kind).toBe('recovery');
    expect(after.week.kind).toBe('push');
    expect(total(after.detail)).toBeGreaterThan(total(before.detail) * 1.4);
  });

  test('explicit minutes set the size of the week', () => {
    const rows = rowsFor([race], profile, [plan('2026-12-07', 'load', { targetMinutes: 300 })]);
    const week = at(rows, '2026-12-07');
    expect(week.week.targetMinutes).toBe(300);
    expect(Math.abs(total(week.detail) - 300)).toBeLessThanOrEqual(45);
  });

  test('weeks that cannot change ignore a plan, even a forged one', () => {
    const raceWeek = at(base, '2027-01-25');
    const forged = seasonWeekDetail({ ...raceWeek.week, plan: plan('2027-01-25', 'rest') }, { profile, races: [race] });
    expect(forged).toEqual(raceWeek.detail);
    expect(at(rowsFor([race], profile, [plan('2027-01-18', 'push')]), '2027-01-18').detail).toEqual(at(base, '2027-01-18').detail);
  });
});

describe('seasonWeekDetail — without a race and for runners', () => {
  test('maintenance weeks still show their key sessions; a whole year stays well formed', () => {
    const profile = withHours(8);
    const rows = rowsFor([], profile);
    expect(rows).toHaveLength(8);
    for (const { week, detail } of rows) {
      if (week.kind === 'load') expect(detail.keySessions.length).toBeGreaterThan(0);
      expect(total(detail)).toBeGreaterThan(0);
    }
    expectWellFormed(rowsFor([], profile, [], 52));
  });

  test('a runner only gets run and strength minutes, led by the long run', () => {
    const race = makeRace({ id: 'm', name: 'Maratón de Sevilla', date: '2027-02-21', distance: 'run_marathon', createdAt: '2026-11-09T10:00:00' });
    const rows = rowsFor([race], withHours(6, { sports: ['run', 'strength'] }));
    expectWellFormed(rows);
    for (const { detail } of rows) expect(Object.keys(detail.sportMinutes).every((s) => s === 'run' || s === 'strength')).toBe(true);
    expect(rows[0]!.detail.keySessions[0]).toMatch(/^Tirada larga \d/);
    expect(rows[rows.length - 1]!.detail.keySessions[0]).toBe('Carrera: Maratón de Sevilla');
  });
});

describe('pinnedRaceSessions', () => {
  const weekStart = '2026-11-09';
  const weekEnd = addDays(weekStart, 6);

  function pinned(race: Race, raceDayPlanned = false) {
    return pinnedRaceSessions({
      info: phaseFor(weekStart, [race]),
      next: phaseFor(addDays(weekStart, 7), [race]),
      kind: 'tri_short',
      firstPlannable: weekStart,
      weekEnd,
      raceDayPlanned,
    });
  }

  test('a race early next week pins its pre-race sessions into this week, never the race itself', () => {
    const specs = pinned(makeRace({ id: 'r', date: '2026-11-17', distance: 'olympic', createdAt: '2026-06-01T10:00:00' }));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some((s) => s.code === 'RACE')).toBe(false);
    for (const s of specs) for (const d of s.allowedDates ?? []) expect(d >= weekStart && d <= weekEnd).toBe(true);
  });

  test("this week's race day is left out when it is already in the calendar", () => {
    const race = makeRace({ id: 'r', name: 'Olímpico', date: '2026-11-15', distance: 'olympic', createdAt: '2026-06-01T10:00:00' });
    expect(pinned(race).some((s) => s.code === 'RACE')).toBe(true);
    expect(pinned(race, true).some((s) => s.code === 'RACE')).toBe(false);
  });
});
