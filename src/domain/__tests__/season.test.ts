import { phaseFor } from '../periodization';
import { applyWeekPlan, buildSeason, canOverride, WEEK_PLAN_OPTIONS } from '../season';
import type { WeekPlan } from '../types';
import { makeRace } from './fixtures';

const TODAY = '2026-11-09'; // Monday

function plan(weekStart: string, kind: WeekPlan['kind'], extra: Partial<WeekPlan> = {}): WeekPlan {
  return { weekStart, kind, targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-09T10:00:00Z', ...extra };
}

describe('buildSeason — race in 4 weeks', () => {
  const race = makeRace({ id: 'a', name: 'Medio de Valencia', date: '2026-12-06', distance: 'half', createdAt: '2026-11-09T10:00:00' });
  const season = buildSeason({ today: TODAY, races: [race], level: 'intermediate', weeklyHoursTarget: 8 });

  test('one row per week up to the race week, the current one first', () => {
    expect(season.weeks.map((w) => w.weekStart)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(season.weeks.map((w) => w.number)).toEqual([1, 2, 3, 4]);
    expect(season.weeks[0]!.isCurrent).toBe(true);
    expect(season.targetRace?.id).toBe('a');
  });

  test('load weeks, then afinamiento and the race', () => {
    expect(season.weeks.map((w) => w.kind)).toEqual(['load', 'load', 'taper', 'race']);
    expect(season.weeks[2]!.label).toBe('Afinamiento');
    expect(season.weeks[3]!.label).toBe('Carrera');
    expect(season.weeks[3]!.race?.id).toBe('a');
  });

  test('target minutes follow the volume factor; the trend says more or less volume', () => {
    for (const w of season.weeks) {
      expect(w.targetMinutes % 5).toBe(0);
      expect(w.targetMinutes).toBe(Math.max(0, Math.round((8 * 60 * w.volumeFactor) / 5) * 5));
    }
    expect(season.weeks[0]!.trend).toBeNull();
    expect(season.weeks[2]!.trend).toBeLessThan(0);
    expect(season.weeks[3]!.targetMinutes).toBeLessThan(season.weeks[2]!.targetMinutes);
  });

  test('summary and a single copy of the short-plan warning', () => {
    expect(season.summary).toBe('Hasta Medio de Valencia: 2 semanas de carga, 1 de afinamiento y la de carrera.');
    expect(season.warnings).toHaveLength(1);
    expect(season.warnings[0]).toMatch(/plan de supervivencia/);
  });

  test('every row explains itself', () => {
    for (const w of season.weeks) {
      expect(w.why.length).toBeGreaterThan(10);
      expect(w.focus.length).toBeGreaterThan(10);
      expect(w.phaseLabel.length).toBeGreaterThan(2);
    }
  });
});

describe('buildSeason — overrides', () => {
  const race = makeRace({ id: 'a', date: '2026-12-06', distance: 'half', createdAt: '2026-11-09T10:00:00' });

  test('a descarga on a load week lowers its volume and is labelled', () => {
    const base = buildSeason({ today: TODAY, races: [race], weeklyHoursTarget: 8 });
    const season = buildSeason({ today: TODAY, races: [race], weeklyHoursTarget: 8, weekPlans: [plan('2026-11-16', 'recovery')] });
    const week = season.weeks[1]!;
    expect(week.kind).toBe('recovery');
    expect(week.label).toBe('Descarga');
    expect(week.plan?.kind).toBe('recovery');
    expect(week.targetMinutes).toBeLessThan(base.weeks[1]!.targetMinutes);
    expect(season.summary).toContain('1 de descarga');
  });

  test('taper and race weeks ignore overrides', () => {
    const season = buildSeason({
      today: TODAY,
      races: [race],
      weeklyHoursTarget: 8,
      weekPlans: [plan('2026-11-23', 'push'), plan('2026-11-30', 'rest')],
    });
    expect(season.weeks[2]!.kind).toBe('taper');
    expect(season.weeks[2]!.plan).toBeNull();
    expect(season.weeks[2]!.editable).toBe(false);
    expect(season.weeks[3]!.kind).toBe('race');
  });

  test('explicit minutes win and a note is appended to the focus', () => {
    const season = buildSeason({
      today: TODAY,
      races: [race],
      weeklyHoursTarget: 8,
      weekPlans: [plan('2026-11-09', 'load', { targetMinutes: 300, note: 'Viaje de trabajo.' })],
    });
    expect(season.weeks[0]!.targetMinutes).toBe(300);
    expect(season.weeks[0]!.focus).toMatch(/Viaje de trabajo\.$/);
  });
});

describe('buildSeason — longer plans and no race', () => {
  test('a long-anchored plan has descargas and "Vuelta a la carga" after them', () => {
    const race = makeRace({ id: 'a', date: '2027-02-07', distance: 'olympic', createdAt: '2026-06-01T10:00:00' });
    const season = buildSeason({ today: TODAY, races: [race], weeklyHoursTarget: 8 });
    expect(season.weeks).toHaveLength(13);
    const kinds = season.weeks.map((w) => w.kind);
    expect(kinds.filter((k) => k === 'recovery').length).toBeGreaterThanOrEqual(2);
    const i = kinds.indexOf('recovery');
    const next = season.weeks[i + 1]!;
    if (next.kind === 'load') expect(next.label).toBe('Vuelta a la carga');
    expect(kinds[kinds.length - 1]).toBe('race');
  });

  test('without a race: 8 maintenance weeks with descargas', () => {
    const season = buildSeason({ today: TODAY, races: [], weeklyHoursTarget: 6 });
    expect(season.weeks).toHaveLength(8);
    expect(season.targetRace).toBeNull();
    expect(season.weeks.some((w) => w.kind === 'recovery')).toBe(true);
    expect(season.summary).toMatch(/^Sin carrera a la vista\. Próximas 8 semanas: /);
    expect(season.weeks.every((w) => w.editable)).toBe(true);
  });

  test('custom horizon', () => {
    expect(buildSeason({ today: TODAY, races: [], weeklyHoursTarget: 6, horizonWeeks: 3 }).weeks).toHaveLength(3);
  });
});

describe('applyWeekPlan', () => {
  const race = makeRace({ id: 'a', date: '2027-04-25', distance: 'half', createdAt: '2026-06-01T10:00:00' });

  test('no plan, or a week that cannot change → same info', () => {
    const info = phaseFor('2027-01-11', [race]);
    expect(applyWeekPlan(info, null, 8)).toBe(info);
    const raceWeek = phaseFor('2027-04-19', [race]);
    expect(canOverride(raceWeek)).toBe(false);
    expect(applyWeekPlan(raceWeek, plan('2027-04-19', 'push'), 8)).toBe(raceWeek);
  });

  test('push, descarga, rest and explicit minutes', () => {
    const info = phaseFor('2027-01-11', [race]);
    expect(info.isRecoveryWeek).toBe(false);
    const push = applyWeekPlan(info, plan('2027-01-11', 'push'), 8);
    expect(push.volumeFactor).toBeCloseTo(Math.round(info.volumeFactor * 1.1 * 100) / 100, 5);
    const down = applyWeekPlan(info, plan('2027-01-11', 'recovery'), 8);
    expect(down.isRecoveryWeek).toBe(true);
    expect(down.volumeFactor).toBeLessThan(info.volumeFactor);
    expect(applyWeekPlan(info, plan('2027-01-11', 'rest'), 8).volumeFactor).toBe(0.35);
    expect(applyWeekPlan(info, plan('2027-01-11', 'load', { targetMinutes: 240 }), 8).volumeFactor).toBe(0.5);
  });

  test('"Carga" on a scheduled descarga brings back the load volume', () => {
    const recovery = buildSeason({ today: TODAY, races: [race], weeklyHoursTarget: 8 }).weeks.find((w) => w.kind === 'recovery');
    expect(recovery).toBeDefined();
    const info = phaseFor(recovery!.weekStart, [race]);
    const load = applyWeekPlan(info, plan(recovery!.weekStart, 'load'), 8);
    expect(load.isRecoveryWeek).toBe(false);
    expect(load.volumeFactor).toBeGreaterThan(info.volumeFactor);
  });

  test('picker labels', () => {
    expect(Object.keys(WEEK_PLAN_OPTIONS)).toEqual(['load', 'push', 'recovery', 'rest']);
    expect(WEEK_PLAN_OPTIONS.recovery.label).toBe('Descarga');
  });
});
