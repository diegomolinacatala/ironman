import { describe, expect, test } from '@jest/globals';

import { addDays } from '@/domain/dates';
import type { DailyMetrics, Workout } from '@/domain/types';

import { makeWorkout } from '../../coach/__tests__/fixtures';
import { areaPath, extent, linePath, linearScale, niceAxis, niceMax, segments, ticks } from '../chartScale';
import { formatDayMonth, formatDecimal, formatHours, formatInt, formatPct, formatSigned, monthShort, spokenInt } from '../format';
import { DISPLAY_WEEKS, PROJECTION_DAYS, buildPmcSeries, interpretFreshness, pmcRanges, pmcSummary, rampText } from '../pmcModel';
import { attributionText, buildRecoverySeries, deltaText, formatRecoveryValue, recoverySummary, sourceLabel } from '../recoveryModel';
import { buildVolumeWeeks, complianceBand, complianceBandLabel, maxWeekMinutes, sportsInWeeks, volumeSummary } from '../volumeModel';

const TODAY = '2026-10-25';

function completed(date: string, overrides: Partial<Workout> = {}): Workout {
  return makeWorkout({
    id: `${date}-${overrides.sport ?? 'run'}`,
    date,
    status: 'completed',
    completed: { durationMin: overrides.durationMin ?? 60, rpe: 5 },
    ...overrides,
  });
}

describe('format', () => {
  test('hours, ints and signs use Spanish typography', () => {
    expect(formatHours(450)).toBe('7,5 h');
    expect(formatHours(480)).toBe('8 h');
    expect(formatHours(-5)).toBe('0 h');
    expect(formatInt(-18.4)).toBe('−18');
    expect(formatInt(-0.2)).toBe('0');
    expect(formatSigned(4)).toBe('+4');
    expect(formatSigned(-3)).toBe('−3');
    expect(formatSigned(0)).toBe('0');
    expect(formatDecimal(7.25)).toBe('7,3');
    expect(formatDecimal(7)).toBe('7');
    expect(spokenInt(-18)).toBe('menos 18');
    expect(formatPct(0.834)).toBe('83 %');
    expect(formatDayMonth('2026-10-05')).toBe('5 oct');
    expect(monthShort('2026-01-31')).toBe('ene');
  });
});

describe('chartScale', () => {
  test('linear scale, nice max and ticks', () => {
    const s = linearScale([0, 100], [200, 0]);
    expect(s(50)).toBe(100);
    expect(linearScale([5, 5], [10, 20])(99)).toBe(10);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(3)).toBe(10);
    expect(niceMax(180)).toBe(200);
    expect(ticks(60, 3)).toEqual([0, 20, 40, 60]);
    expect(niceAxis(104)).toEqual({ max: 125, step: 25 });
    expect(niceAxis(44)).toEqual({ max: 50, step: 10 });
    expect(niceAxis(88)).toEqual({ max: 100, step: 20 });
    expect(niceAxis(3)).toEqual({ max: 10, step: 2 });
  });

  test('paths and segments', () => {
    expect(linePath([])).toBe('');
    expect(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }])).toBe('M0.0 1.0 L2.0 3.0');
    expect(areaPath([{ x: 0, y: 1 }, { x: 2, y: 3 }], 10)).toContain('Z');
    expect(areaPath([], 10)).toBe('');
    expect(segments([1, null, 2, 3, null])).toEqual([[{ index: 0, value: 1 }], [{ index: 2, value: 2 }, { index: 3, value: 3 }]]);
    expect(extent([3, 1, 2])).toEqual([1, 3]);
    expect(extent([])).toEqual([0, 0]);
  });
});

describe('pmcModel', () => {
  test('ranges cover warm-up, 12 weeks and 2 weeks of projection', () => {
    const { fetch, display } = pmcRanges(TODAY);
    expect(display.from).toBe(addDays('2026-10-19', -7 * (DISPLAY_WEEKS - 1)));
    expect(display.to).toBe(addDays(TODAY, PROJECTION_DAYS));
    expect(fetch.from < display.from).toBe(true);
  });

  test('builds an empty-but-valid series without data', () => {
    const series = buildPmcSeries({ workouts: [], events: [], today: TODAY });
    expect(series.hasData).toBe(false);
    // Today is a Sunday, so the 12 display weeks are complete.
    expect(series.points.length).toBe(DISPLAY_WEEKS * 7 + PROJECTION_DAYS);
    expect(series.latest?.date).toBe(TODAY);
    expect(pmcSummary({ ...series, latest: null })).toContain('Sin datos');
  });

  test('completed load raises fitness; planned sessions only after today', () => {
    // Harder last week than the previous ones → fitness rises.
    const history = Array.from({ length: 40 }, (_, i) =>
      completed(addDays(TODAY, -i), { durationMin: i < 7 ? 120 : 45, completed: { durationMin: i < 7 ? 120 : 45, rpe: 5 } }),
    );
    const planned = makeWorkout({ id: 'future', date: addDays(TODAY, 3), durationMin: 120 });
    const missed = makeWorkout({ id: 'missed', date: addDays(TODAY, -2), durationMin: 300 });
    const series = buildPmcSeries({ workouts: [...history, planned, missed], events: [], today: TODAY });

    expect(series.hasData).toBe(true);
    expect(series.latest?.ctl ?? 0).toBeGreaterThan(10);
    expect(series.rampWeek).toBeGreaterThan(0);
    const futurePoint = series.points.find((p) => p.date === addDays(TODAY, 3));
    expect(futurePoint?.load ?? 0).toBeGreaterThan(0);
    const missedPoint = series.points.find((p) => p.date === addDays(TODAY, -2));
    // Only the completed session of that day counts, not the 300' missed one.
    expect(missedPoint?.load ?? 0).toBeLessThan(150);
    expect(pmcSummary(series)).toContain('Forma física');
  });

  test('short history is seeded instead of starting from zero (cold start)', () => {
    const recent = Array.from({ length: 21 }, (_, i) => completed(addDays(TODAY, -i)));
    const series = buildPmcSeries({ workouts: recent, events: [], today: TODAY });
    expect(series.seeded).toBe(true);
    expect(series.firstIndex).toBe(series.points.findIndex((p) => p.date === addDays(TODAY, -20)));
    // Same daily load every day + seed at that load → fitness ≈ fatigue, freshness ≈ 0.
    expect(Math.abs(series.latest?.tsb ?? 99)).toBeLessThan(3);
    expect(series.points[0]).toMatchObject({ ctl: 0, atl: 0, load: 0 });
  });

  test('long history is not seeded', () => {
    const { fetch } = pmcRanges(TODAY);
    const long = [completed(addDays(fetch.from, 3)), completed(addDays(TODAY, -1))];
    const series = buildPmcSeries({ workouts: long, events: [], today: TODAY });
    expect(series.seeded).toBe(false);
    expect(series.firstIndex).toBe(0);
  });

  test('freshness readings follow the research thresholds', () => {
    expect(interpretFreshness(30).tone).toBe('detraining');
    expect(interpretFreshness(12).tone).toBe('fresh');
    expect(interpretFreshness(0).tone).toBe('neutral');
    expect(interpretFreshness(-18)).toEqual({
      tone: 'productive',
      text: 'Frescura −18: semana cargada, de las que construyen forma; cuida el sueño.',
    });
    expect(interpretFreshness(-25).tone).toBe('high');
    expect(interpretFreshness(-35).tone).toBe('risk');
    expect(rampText(0)).toBe('Forma física estable esta semana');
    expect(rampText(4.4)).toBe('Forma física +4 en 7 días');
  });
});

describe('volumeModel', () => {
  test('8 weekly columns with completed minutes per sport and planned outline', () => {
    const workouts = [
      completed('2026-10-20', { sport: 'swim', durationMin: 45 }),
      completed('2026-10-21', { sport: 'bike', durationMin: 90 }),
      makeWorkout({ id: 'planned', date: '2026-10-25', durationMin: 60 }),
      completed('2026-10-13', { sport: 'run', durationMin: 50 }),
    ];
    const weeks = buildVolumeWeeks(workouts, TODAY);
    expect(weeks).toHaveLength(8);
    const current = weeks[7];
    expect(current?.isCurrent).toBe(true);
    expect(current?.weekStart).toBe('2026-10-19');
    expect(current?.bySport).toEqual([
      { sport: 'swim', minutes: 45 },
      { sport: 'bike', minutes: 90 },
    ]);
    expect(current?.plannedMin).toBe(45 + 90 + 60);
    expect(weeks[6]?.completedMin).toBe(50);
    expect(sportsInWeeks(weeks)).toEqual(['swim', 'bike', 'run']);
    expect(maxWeekMinutes(weeks)).toBe(195);
    expect(volumeSummary(weeks)).toContain('Esta semana llevas');
    expect(volumeSummary([])).toBe('Sin datos de volumen.');
  });

  test('compliance bands', () => {
    expect(complianceBand(0.9)).toBe('done');
    expect(complianceBand(0.6)).toBe('partial');
    expect(complianceBand(0.2)).toBe('off');
    expect(complianceBandLabel('partial')).toBe('Desviada');
  });
});

describe('recoveryModel', () => {
  function metric(date: string, source: DailyMetrics['source'], values: Partial<DailyMetrics>): DailyMetrics {
    return {
      userId: 'me',
      date,
      source,
      hrvMs: null,
      restingHr: null,
      sleepHours: null,
      sleepScore: null,
      bodyBattery: null,
      trainingReadiness: null,
      vo2max: null,
      steps: null,
      stressAvg: null,
      trainingStatus: null,
      ...values,
    };
  }

  test('prefers Garmin over Salud per day and tracks attribution', () => {
    const metrics = [
      metric('2026-10-24', 'healthkit', { hrvMs: 40, sleepHours: 7 }),
      metric('2026-10-24', 'garmin', { hrvMs: 60 }),
      metric('2026-10-25', 'garmin', { hrvMs: 66, restingHr: 48 }),
      metric('2026-09-01', 'garmin', { hrvMs: 99 }), // outside the window
    ];
    const [hrv, rhr, sleep] = buildRecoverySeries(metrics, TODAY);
    expect(hrv?.values).toHaveLength(28);
    expect(hrv?.values.slice(-2)).toEqual([60, 66]);
    expect(hrv?.latest).toBe(66);
    expect(hrv?.average).toBe(63);
    expect(hrv?.deltaPct).toBeCloseTo(3 / 63);
    expect(hrv?.sources).toEqual(['garmin']);
    expect(sleep?.sources).toEqual(['healthkit']);
    expect(sleep?.latestDate).toBe('2026-10-24');
    expect(rhr?.latest).toBe(48);
    expect(attributionText([hrv!, rhr!, sleep!])).toBe('Datos: Garmin · Salud');
    expect(sourceLabel('manual')).toBe('Manual');
  });

  test('texts', () => {
    expect(deltaText(null)).toBeNull();
    expect(deltaText(0.001)).toBe('En tu media');
    expect(deltaText(0.06)).toBe('+6 % vs. tu media');
    expect(deltaText(-0.04)).toBe('−4 % vs. tu media');
    expect(formatRecoveryValue({ key: 'sleepHours' }, 7.46)).toBe('7,5');
    expect(formatRecoveryValue({ key: 'hrvMs' }, 61.6)).toBe('62');
    const [empty] = buildRecoverySeries([], TODAY);
    expect(empty && recoverySummary(empty)).toContain('sin datos');
    expect(attributionText(buildRecoverySeries([], TODAY))).toBeNull();
  });
});
