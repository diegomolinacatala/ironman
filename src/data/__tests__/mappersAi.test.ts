/// <reference types="jest" />
import { parseBriefing, parseCoachExtras, parseMealAnalysis, parseSleepSnapshot, rowToBriefing } from '../supabase/mappersAi';
import { topicsForChange, OWN_TABLE_TOPICS } from '../supabase/realtime';
import type { BriefingRow } from '../supabase/rows';

const NOW = '2026-10-27T06:00:00.000Z';
const SLEEP = {
  hours: 7.333,
  score: 82,
  deepMin: 80,
  lightMin: 250,
  remMin: 110,
  awakeMin: 20,
  start: '2026-10-26T22:30:00.000Z',
  end: '2026-10-27T05:50:00.000Z',
  hrvMs: 68.04,
  hrvBaselineMs: 66.5,
  restingHr: 49,
  bodyBattery: 74,
};

const ROW: BriefingRow = {
  user_id: 'me',
  date: '2026-10-27',
  headline: "Dormiste 7 h 20' · Hoy rodaje suave 50'",
  sleep_verdict: 'good',
  sleep_summary: 'Buena noche.',
  script: 'Buenos días, Diego.',
  focus: 'Suave de verdad.',
  sleep: SLEEP,
  model: 'claude-opus-5-5',
  created_at: '2026-10-27T05:55:00.000Z',
  updated_at: '2026-10-27T06:20:00.000Z',
};

describe('briefings rows and responses', () => {
  it('maps a briefings row (engine ai, newest write time)', () => {
    expect(rowToBriefing(ROW)).toEqual({
      date: '2026-10-27',
      headline: ROW.headline,
      sleepVerdict: 'good',
      sleepSummary: 'Buena noche.',
      script: 'Buenos días, Diego.',
      focus: 'Suave de verdad.',
      sleep: { ...SLEEP, hours: 7.33, hrvMs: 68 },
      engine: 'ai',
      createdAt: '2026-10-27T06:20:00.000Z',
    });
    const odd = rowToBriefing({ ...ROW, sleep_verdict: 'meh', sleep: null, updated_at: undefined });
    expect(odd).toMatchObject({ sleepVerdict: 'unknown', sleep: null, createdAt: ROW.created_at });
  });

  it('reads the sleep snapshot defensively (snake_case, text, junk)', () => {
    expect(parseSleepSnapshot({ hours: '6.5', deep_min: 70, hrv_ms: -1, resting_hr: 'x', start: 'nope' })).toMatchObject({
      hours: 6.5,
      deepMin: 70,
      hrvMs: null,
      restingHr: null,
      start: null,
    });
    expect(parseSleepSnapshot(JSON.stringify(SLEEP))?.score).toBe(82);
    expect(parseSleepSnapshot('{bad json')).toBeNull();
    expect(parseSleepSnapshot([1, 2])).toBeNull();
    expect(parseSleepSnapshot(null)).toBeNull();
  });

  it('parses the briefing function response', () => {
    const body = { ...rowToBriefing(ROW), engine: 'ai' };
    expect(parseBriefing(body, '2026-10-27', NOW)).toEqual(body);
    expect(parseBriefing(JSON.stringify(body), '2026-10-27', NOW)?.headline).toBe(ROW.headline);
    const loose = parseBriefing({ headline: ' Hola ', script: 'Texto', date: 'ayer', sleep_verdict: 'poor', created_at: 'x' }, '2026-10-27', NOW);
    expect(loose).toEqual({
      date: '2026-10-27',
      headline: 'Hola',
      sleepVerdict: 'poor',
      sleepSummary: '',
      script: 'Texto',
      focus: '',
      sleep: null,
      engine: 'ai',
      createdAt: NOW,
    });
    expect(parseBriefing({ headline: '', script: 'x' }, '2026-10-27', NOW)).toBeNull();
    expect(parseBriefing({ headline: 'x' }, '2026-10-27', NOW)).toBeNull();
    expect(parseBriefing(null, '2026-10-27', NOW)).toBeNull();
  });
});

describe('meal function response', () => {
  const INPUT = { date: '2026-10-27', time: '14:30' };

  it('narrows items, macros, slot and confidence', () => {
    const parsed = parseMealAnalysis(
      {
        meal: 'lunch',
        description: ' Pasta con atún ',
        items: ['Pasta · 250 g', 3, '  ', 'Atún · 80 g'],
        kcal: 612.6,
        carbs_g: '80',
        proteinG: 35,
        fatG: -2,
        confidence: 'high',
        tip: 'Bien.',
      },
      INPUT,
    );
    expect(parsed).toEqual({
      meal: 'lunch',
      description: 'Pasta con atún',
      items: ['Pasta · 250 g', 'Atún · 80 g'],
      kcal: 613,
      carbsG: 80,
      proteinG: 35,
      fatG: null,
      confidence: 'high',
      tip: 'Bien.',
      engine: 'ai',
    });
  });

  it('falls back to the time slot and medium confidence, rejects responses without description', () => {
    expect(parseMealAnalysis({ description: 'Algo', meal: 'brunch', confidence: '??', tip: '' }, { ...INPUT, time: '21:00' })).toMatchObject({
      meal: 'dinner',
      items: [],
      kcal: null,
      confidence: 'medium',
      tip: null,
    });
    expect(parseMealAnalysis({ items: [] }, INPUT)).toBeNull();
    expect(parseMealAnalysis('not json', INPUT)).toBeNull();
  });
});

describe('coach job extras', () => {
  it('reads memory lines and the life event id', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseCoachExtras({ memory: [' Prefiere nadar por la mañana ', '', 4], lifeEventId: id })).toEqual({
      memory: ['Prefiere nadar por la mañana'],
      lifeEventId: id,
    });
    expect(parseCoachExtras(JSON.stringify({ memory: ['a', 'b', 'c', 'd', 'e', 'f'], life_event_id: 'not-a-uuid' }))).toEqual({
      memory: ['a', 'b', 'c', 'd', 'e'],
      lifeEventId: null,
    });
    expect(parseCoachExtras(null)).toEqual({ memory: [], lifeEventId: null });
  });
});

describe('realtime briefings topic', () => {
  it('maps the briefings table to the briefings topic', () => {
    expect(OWN_TABLE_TOPICS.briefings).toBe('briefings');
    expect(topicsForChange('briefings', { new: { user_id: 'me' } })).toEqual(['briefings']);
  });
});
