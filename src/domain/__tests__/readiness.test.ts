import { addDays } from '../dates';
import { POSSIBLE_ILLNESS_MESSAGE } from '../illness';
import { YESTERDAY_DATA_NOTE, computeReadiness } from '../readiness';
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

describe('watch not synced yet today', () => {
  test("yesterday's metrics stand in, said in the factors", () => {
    const yesterday = addDays(TODAY, -1);
    const metrics = history(20).map((m) => (m.date === yesterday ? { ...m, restingHr: 58 } : m));
    const r = computeReadiness({ today: TODAY, checkin: null, metrics });
    expect(r.level).toBe('red');
    expect(r.factors).toContain(YESTERDAY_DATA_NOTE);
  });

  test("yesterday's sleep is not read as last night's", () => {
    const yesterday = addDays(TODAY, -1);
    const metrics = history(20).map((m) => (m.date === yesterday ? { ...m, sleepHours: 4 } : m));
    const r = computeReadiness({ today: TODAY, checkin: null, metrics });
    expect(r.factors.join(' ')).not.toMatch(/Has dormido/);
    expect(r.level).toBe('green');
  });

  test('older data still means unknown', () => {
    const r = computeReadiness({ today: TODAY, checkin: null, metrics: [makeMetrics(addDays(TODAY, -3))] });
    expect(r.level).toBe('unknown');
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

describe('illness signals and the morning answer', () => {
  const nights = history(20, { sleepRespiration: 14.5, sleepAvgHr: 52 });
  const highNight = makeMetrics(TODAY, { sleepRespiration: 16, sleepAvgHr: 59 });
  const breathingOnly = makeMetrics(TODAY, { sleepRespiration: 16, sleepAvgHr: 52 });

  test('symptoms with a likely signal turn the day red, with tact', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'symptoms' }), metrics: [...nights, highNight] });
    expect(r.level).toBe('red');
    expect(r.factors).toContain('Respiración y pulso de esta noche altos y notas síntomas');
    expect(r.recommendation).toBe(POSSIBLE_ILLNESS_MESSAGE);
    expect(r.illness).toMatchObject({ kind: 'possible_illness', level: 'likely' });
  });

  test('symptoms with a single signal, or feeling ill with normal numbers, make it amber', () => {
    const watch = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'symptoms' }), metrics: [...nights, breathingOnly] });
    expect(watch.level).toBe('amber');
    expect(watch.recommendation).toBe(POSSIBLE_ILLNESS_MESSAGE);
    const normal = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'symptoms' }), metrics: [...nights, makeMetrics(TODAY, { sleepRespiration: 14.5, sleepAvgHr: 52 })] });
    expect(normal.level).toBe('amber');
    expect(normal.factors).toContain('Notas síntomas: garganta, mocos o cansancio raro');
  });

  test('alcohol, heat or stress explain it: a note, no alarm, the plan stays', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'alcohol' }), metrics: [...nights, breathingOnly] });
    expect(r.level).toBe('green');
    expect(r.factors).toEqual(['Respiración de esta noche alta, seguramente por el alcohol o la cena tardía']);
    expect(r.recommendation).toBe('Todo en orden: sigue el plan de hoy.');
    expect(r.illness?.kind).toBe('explained');
  });

  test('an explained night still eases off when the rest of readiness is low', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'stress', fatigue: 4 }), metrics: [...nights, { ...breathingOnly, sleepHours: 5 }] });
    expect(r.level).toBe('amber');
    expect(r.recommendation).toMatch(/con freno/);
    expect(r.recommendation).not.toMatch(/malo/);
  });

  test('"bien" keeps the plan and mentions it lightly', () => {
    const r = computeReadiness({ today: TODAY, checkin: makeCheckin({ illnessAnswer: 'fine' }), metrics: [...nights, highNight] });
    expect(r.level).toBe('green');
    expect(r.factors).toEqual(['Respiración y pulso de esta noche altos, pero te encuentras bien']);
  });

  test('before answering, breathing up is a note; a high resting HR alone is not repeated', () => {
    const noAnswer = computeReadiness({ today: TODAY, checkin: null, metrics: [...nights, breathingOnly] });
    expect(noAnswer.level).toBe('green');
    expect(noAnswer.factors).toEqual(['Respiración de esta noche alta frente a tu media']);
    const rhrOnly = computeReadiness({ today: TODAY, checkin: null, metrics: [...history(20), makeMetrics(TODAY, { restingHr: 56 })] });
    expect(rhrOnly.factors.filter((f) => /esta noche/.test(f))).toEqual([]);
    expect(rhrOnly.illness?.kind).toBe('unanswered');
  });
});

describe('metrics sources', () => {
  test('COROS ranks after Garmin and before HealthKit for the same day', () => {
    const base = history(20).map((m) => ({ ...m, restingHr: 50 }));
    const corosHigh = [...base, makeMetrics(TODAY, { source: 'healthkit', restingHr: 50 }), makeMetrics(TODAY, { source: 'coros', restingHr: 58, trainingReadiness: null })];
    expect(computeReadiness({ today: TODAY, checkin: null, metrics: corosHigh }).level).toBe('red');
    const garminWins = [...corosHigh, makeMetrics(TODAY, { source: 'garmin', restingHr: 50 })];
    expect(computeReadiness({ today: TODAY, checkin: null, metrics: garminWins }).level).toBe('green');
  });
});
