import { addDays } from '../dates';
import { computeReadiness } from '../readiness';
import type { DailyMetrics } from '../types';
import { makeCheckin, makeMetrics } from './fixtures';

const TODAY = '2026-10-25';

function history(days: number, overrides: Partial<DailyMetrics> = {}): DailyMetrics[] {
  return Array.from({ length: days }, (_, i) => makeMetrics(addDays(TODAY, -(i + 1)), overrides));
}

describe('computeReadiness', () => {
  test('no data → unknown', () => {
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [] });
    expect(r).toEqual(expect.objectContaining({ level: 'unknown', score: null }));
    expect(r.recommendation).toMatch(/check-in/);
  });

  test('all good → green with score from Garmin and own signals', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin(), metrics: [...history(20), makeMetrics(TODAY)] });
    expect(r.level).toBe('green');
    expect(r.score).toBeGreaterThan(60);
    expect(r.factors).toEqual([]);
  });

  test('resting HR +8 → red', () => {
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [...history(20), makeMetrics(TODAY, { restingHr: 58 })] });
    expect(r.level).toBe('red');
    expect(r.factors.join(' ')).toMatch(/FC en reposo \+8/);
    expect(r.score).toBeLessThanOrEqual(30);
  });

  test('resting HR +5 two days in a row → red', () => {
    const yesterday = addDays(TODAY, -1);
    const metrics = [...history(20).map((m) => (m.date === yesterday ? { ...m, restingHr: 55 } : m)), makeMetrics(TODAY, { restingHr: 55 })];
    expect(computeReadiness({ today: TODAY, checkin: null, metrics }).level).toBe('red');
  });

  test('two amber signals → amber (short sleep + high fatigue)', () => {
    const r = computeReadiness({
      today: TODAY,
      checkin: makeCheckin({ fatigue: 4 }),
      metrics: [...history(20), makeMetrics(TODAY, { sleepHours: 5.2 })],
    });
    expect(r.level).toBe('amber');
    expect(r.score).toBeLessThanOrEqual(60);
    expect(r.factors.join(' ')).toMatch(/dormido 5,2 h/);
  });

  test('two short nights in a row (SL2) and a short week (SL3) → amber', () => {
    const shortWeek = history(20).map((m) => (m.date >= addDays(TODAY, -6) ? { ...m, sleepHours: 5.5 } : m));
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [...shortWeek, makeMetrics(TODAY, { sleepHours: 5.4 })] });
    expect(r.level).toBe('amber');
    expect(r.factors.join(' ')).toMatch(/Dos noches seguidas/);
    expect(r.factors.join(' ')).toMatch(/Media de sueño/);
  });

  test('one amber signal → green with a note recommendation', () => {
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [...history(20), makeMetrics(TODAY, { trainingReadiness: 40 })] });
    expect(r.level).toBe('green');
    expect(r.factors).toHaveLength(1);
    expect(r.recommendation).toMatch(/si te notas cansado/);
  });

  test('Garmin readiness < 25 and fatigue 5 are red', () => {
    expect(computeReadiness({ today: TODAY, checkin: null, metrics: [makeMetrics(TODAY, { trainingReadiness: 20 })] }).level).toBe('red');
    expect(computeReadiness({ today: TODAY, checkin: makeCheckin({ fatigue: 5 }), metrics: [] }).level).toBe('red');
  });

  test('HRV 7-day average below the smallest worthwhile change → amber signal', () => {
    const base = Array.from({ length: 30 }, (_, i) => makeMetrics(addDays(TODAY, -(i + 1)), { hrvMs: 60 + (i % 3) }));
    const lowWeek = base.map((m) => (m.date >= addDays(TODAY, -6) ? { ...m, hrvMs: 42 } : m));
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ soreness: 4 }), metrics: [...lowWeek, makeMetrics(TODAY, { hrvMs: 40 })] });
    expect(r.factors.join(' ')).toMatch(/VFC \d+ % bajo tu media/);
    expect(r.level).toBe('amber');
  });

  test('notes: low body battery, stress, motivation; yesterday check-in ignored', () => {
    const r = computeReadiness({
      today: TODAY,
      checkin: makeCheckin({ stress: 5, motivation: 1, sleepQuality: 2 }),
      metrics: [makeMetrics(TODAY, { bodyBattery: 10, stressAvg: 70, trainingReadiness: null, sleepHours: null, sleepScore: null })],
    });
    expect(r.factors.join(' ')).toMatch(/Batería corporal baja/);
    expect(r.factors.join(' ')).toMatch(/Estrés alto/);
    expect(r.factors.join(' ')).toMatch(/Motivación muy baja/);
    const old = computeReadiness({ today: TODAY, checkin: makeCheckin({ date: '2026-10-20', fatigue: 5 }), metrics: [] });
    expect(old.level).toBe('unknown');
  });

  test('prefers Garmin over other sources on the same day', () => {
    const metrics = [makeMetrics(TODAY, { source: 'healthkit', trainingReadiness: 10 }), makeMetrics(TODAY, { source: 'garmin', trainingReadiness: 80 })];
    expect(computeReadiness({ today: TODAY, checkin: null, metrics }).level).toBe('green');
  });
});

describe('§11.8 signal counting (ENG-11)', () => {
  test('fatigue and soreness together are one signal: green with a note', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ fatigue: 4, soreness: 4, sleepHours: 8 }), metrics: [] });
    expect(r.level).toBe('green');
    expect(r.recommendation).toMatch(/si te notas cansado/);
    expect(r.factors.join(' ')).toMatch(/Fatiga y dolor muscular altos/);
  });

  test('watch readiness below 50 plus a bad subjective night stays green with a note', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ sleepQuality: 2 }), metrics: [...history(20), makeMetrics(TODAY, { trainingReadiness: 45 })] });
    expect(r.level).toBe('green');
    expect(r.factors.join(' ')).toMatch(/Has dormido mal/);
  });

  test('a low 7-day sleep average alone is a note, not an amber signal', () => {
    const shortWeek = history(20).map((m) => (m.date >= addDays(TODAY, -6) ? { ...m, sleepHours: 6.1 } : m));
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [...shortWeek, makeMetrics(TODAY, { sleepHours: 6.2, trainingReadiness: 45 })] });
    expect(r.level).toBe('green');
    expect(r.factors.join(' ')).toMatch(/Media de sueño/);
  });
});
