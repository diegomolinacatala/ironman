import { describe, expect, test } from '@jest/globals';

import {
  buildMetricsDrafts,
  mapHealthActivity,
  quantityToMeters,
  quantityToMinutes,
  sleepHoursByDate,
  statsByDate,
} from '../health/mapping';

describe('mapHealthActivity', () => {
  test('maps triathlon sports', () => {
    expect(mapHealthActivity(37)?.sport).toBe('run');
    expect(mapHealthActivity(13)?.sport).toBe('bike');
    expect(mapHealthActivity(46)?.sport).toBe('swim');
    expect(mapHealthActivity(82)?.sport).toBe('brick');
    expect(mapHealthActivity(50)?.sport).toBe('strength');
    expect(mapHealthActivity(57)?.sport).toBe('mobility');
  });

  test('padel / tennis / football land in "other" with Spanish titles', () => {
    expect(mapHealthActivity(48)).toEqual({ sport: 'other', title: 'Tenis' });
    expect(mapHealthActivity(41)).toEqual({ sport: 'other', title: 'Fútbol' });
    expect(mapHealthActivity(34)).toEqual({ sport: 'other', title: 'Pádel / raqueta' });
    expect(mapHealthActivity(3000)).toEqual({ sport: 'other', title: 'Actividad' });
  });

  test('ignores walks and multisport transitions', () => {
    expect(mapHealthActivity(52)).toBeNull();
    expect(mapHealthActivity(83)).toBeNull();
  });
});

describe('quantity conversions', () => {
  test('time units to minutes', () => {
    expect(quantityToMinutes({ quantity: 3600, unit: 's' })).toBe(60);
    expect(quantityToMinutes({ quantity: 1.5, unit: 'hr' })).toBe(90);
    expect(quantityToMinutes({ quantity: 42, unit: 'min' })).toBe(42);
    expect(quantityToMinutes({ quantity: 1, unit: 'furlong' })).toBeNull();
    expect(quantityToMinutes(undefined)).toBeNull();
  });

  test('length units to metres', () => {
    expect(quantityToMeters({ quantity: 10.5, unit: 'km' })).toBe(10500);
    expect(quantityToMeters({ quantity: 1500, unit: 'm' })).toBe(1500);
    expect(quantityToMeters({ quantity: 1, unit: 'mi' })).toBeCloseTo(1609.344);
    expect(quantityToMeters({ quantity: Number.NaN, unit: 'm' })).toBeNull();
  });
});

describe('sleepHoursByDate', () => {
  test('sums asleep stages of a night into the wake-up date, ignoring in-bed/awake', () => {
    const samples = [
      { startDate: new Date(2026, 9, 26, 23, 0), endDate: new Date(2026, 9, 26, 23, 50), value: 3 },
      { startDate: new Date(2026, 9, 26, 23, 50), endDate: new Date(2026, 9, 27, 2, 0), value: 4 },
      { startDate: new Date(2026, 9, 27, 2, 0), endDate: new Date(2026, 9, 27, 2, 30), value: 2 },
      { startDate: new Date(2026, 9, 27, 2, 30), endDate: new Date(2026, 9, 27, 7, 0), value: 5 },
      { startDate: new Date(2026, 9, 26, 22, 30), endDate: new Date(2026, 9, 27, 7, 15), value: 0 },
    ];
    expect(sleepHoursByDate(samples)).toEqual({ '2026-10-27': 7.5 });
  });

  test('merges overlapping samples from several sources', () => {
    const samples = [
      { startDate: new Date(2026, 9, 27, 0, 0), endDate: new Date(2026, 9, 27, 6, 0), value: 1 },
      { startDate: new Date(2026, 9, 27, 1, 0), endDate: new Date(2026, 9, 27, 7, 0), value: 3 },
    ];
    expect(sleepHoursByDate(samples)).toEqual({ '2026-10-27': 7 });
  });
});

describe('daily metrics', () => {
  test('statsByDate keys buckets by local date', () => {
    const rows = [
      { startDate: new Date(2026, 9, 26, 0, 0), quantity: { quantity: 48.4, unit: 'count/min' } },
      { startDate: new Date(2026, 9, 27, 0, 0), quantity: undefined },
    ];
    expect(statsByDate(rows)).toEqual({ '2026-10-26': 48.4 });
  });

  test('buildMetricsDrafts keeps only days with data and rounds values', () => {
    const drafts = buildMetricsDrafts(['2026-10-26', '2026-10-27'], {
      sleepHours: { '2026-10-26': 7.25 },
      restingHr: { '2026-10-26': 48.44 },
      hrvMs: {},
      steps: { '2026-10-26': 10234.6, '2026-10-27': 0 },
      vo2max: {},
    });
    expect(drafts).toEqual([
      {
        date: '2026-10-26',
        source: 'healthkit',
        hrvMs: null,
        restingHr: 48.4,
        sleepHours: 7.25,
        sleepScore: null,
        bodyBattery: null,
        trainingReadiness: null,
        vo2max: null,
        steps: 10235,
        stressAvg: null,
        trainingStatus: null,
      },
    ]);
  });
});
