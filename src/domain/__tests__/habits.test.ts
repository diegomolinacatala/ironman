import { addDays } from '../dates';
import { DEFAULT_HABITS, HABITS, JOURNAL_SIZE, allAnswered, cleanHabitAnswers, habitAnswerLines, isHabitId, journalHabitsOf } from '../habitCatalog';
import { IMPACT_MIN_ANSWERS, habitImpacts, impactSummary } from '../habitImpacts';
import { computeReadiness } from '../readiness';
import { HABIT_IDS, type DailyCheckin, type DailyMetrics, type HabitId } from '../types';
import { makeCheckin, makeMetrics } from './fixtures';

const TODAY = '2026-10-25';

describe('habit catalogue', () => {
  test('every habit has copy; the defaults are JOURNAL_SIZE known habits', () => {
    for (const id of HABIT_IDS) {
      expect(HABITS[id].id).toBe(id);
      expect(HABITS[id].question).toMatch(/^¿.+\?$/);
      expect(HABITS[id].label.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_HABITS).toHaveLength(JOURNAL_SIZE);
    expect(DEFAULT_HABITS.every(isHabitId)).toBe(true);
  });

  test('journalHabitsOf: saved choice (known, unique, at most 5) or the defaults', () => {
    expect(journalHabitsOf(null)).toEqual([...DEFAULT_HABITS]);
    expect(journalHabitsOf({ journalHabits: [] })).toEqual([...DEFAULT_HABITS]);
    expect(journalHabitsOf({ journalHabits: ['sauna', 'nap'] })).toEqual(['sauna', 'nap']);
    const messy = ['sauna', 'sauna', 'beer', 'nap', 'travel', 'sick', 'alcohol', 'late_meal'] as unknown as HabitId[];
    expect(journalHabitsOf({ journalHabits: messy })).toEqual(['sauna', 'nap', 'travel', 'sick', 'alcohol']);
  });

  test('cleanHabitAnswers keeps known habits with boolean answers only', () => {
    expect(cleanHabitAnswers({ alcohol: true, nap: false, beer: true, sick: 'sí' })).toEqual({ alcohol: true, nap: false });
    expect(cleanHabitAnswers(null)).toEqual({});
    expect(cleanHabitAnswers([true])).toEqual({});
  });

  test('allAnswered and the plain-text lines for the coach', () => {
    expect(allAnswered(['alcohol', 'nap'], { alcohol: true })).toBe(false);
    expect(allAnswered(['alcohol', 'nap'], { alcohol: true, nap: false })).toBe(true);
    expect(habitAnswerLines({ nap: false, alcohol: true })).toEqual(['Bebió alcohol ayer: sí', 'Echó la siesta ayer: no']);
  });
});

describe('readiness with the journal', () => {
  const metrics = Array.from({ length: 21 }, (_, i) => makeMetrics(addDays(TODAY, -i)));

  test('feeling ill makes the day amber on its own; a niggle is a note', () => {
    const sick = computeReadiness({ today: TODAY, checkin: makeCheckin({ habits: { sick: true } }), metrics });
    expect(sick.level).toBe('amber');
    expect(sick.factors.join(' ')).toMatch(/enfermo/);
    const niggle = computeReadiness({ today: TODAY, checkin: makeCheckin({ habits: { niggle: true } }), metrics });
    expect(niggle.level).toBe('green');
    expect(niggle.factors.join(' ')).toMatch(/molestia/);
  });

  test('unanswered scales count as nothing (journal-only check-in)', () => {
    const journalOnly = makeCheckin({ sleepQuality: null, fatigue: null, soreness: null, stress: null, motivation: null, habits: { alcohol: false } });
    const r = computeReadiness({ today: TODAY, checkin: journalOnly, metrics });
    expect(r.level).toBe('green');
    expect(r.factors).toEqual([]);
    expect(r.score).not.toBeNull();
  });
});

/** 30 days of answers: "sí" to alcohol every third day, and those mornings the HRV and the watch readiness drop. */
function journalHistory(): { checkins: DailyCheckin[]; metrics: DailyMetrics[] } {
  const checkins: DailyCheckin[] = [];
  const metrics: DailyMetrics[] = [];
  for (let i = 0; i < 60; i += 1) {
    const date = addDays(TODAY, -i);
    const drank = i % 3 === 0;
    metrics.push(makeMetrics(date, drank && i < 30 ? { hrvMs: 50, trainingReadiness: 45 } : {}));
    if (i < 30) checkins.push(makeCheckin({ date, habits: { alcohol: drank, hydration: true, nap: i % 2 === 0 } }));
  }
  return { checkins, metrics };
}

describe('habitImpacts', () => {
  test('a habit linked to worse recovery reads "worse" and comes first', () => {
    const { checkins, metrics } = journalHistory();
    const impacts = habitImpacts({ today: TODAY, habits: ['nap', 'alcohol'], checkins, metrics });
    const alcohol = impacts.find((i) => i.habit === 'alcohol');
    expect(alcohol).toMatchObject({ direction: 'worse', yesDays: 10, noDays: 20 });
    expect(alcohol?.delta).toBeLessThan(0);
    expect(impactSummary(alcohol!)).toMatch(/^−\d+ puntos de recuperación los días que sí$/);
    expect(impacts[0]?.habit).toBe('alcohol');
  });

  test('needs 5 "sí" and 5 "no": an always-yes habit keeps collecting', () => {
    const { checkins, metrics } = journalHistory();
    const [hydration] = habitImpacts({ today: TODAY, habits: ['hydration'], checkins, metrics });
    expect(hydration).toMatchObject({ delta: null, direction: null, noDays: 0 });
    expect(impactSummary(hydration!)).toBe(`Faltan ${IMPACT_MIN_ANSWERS} «no» con datos del reloj`);
  });

  test('without watch data nothing is computed (the journal cannot judge itself)', () => {
    const { checkins } = journalHistory();
    const [alcohol] = habitImpacts({ today: TODAY, habits: ['alcohol'], checkins, metrics: [] });
    expect(alcohol).toMatchObject({ yesDays: 0, noDays: 0, delta: null });
  });

  test('answers older than 90 days are ignored', () => {
    const old = makeCheckin({ date: addDays(TODAY, -120), habits: { alcohol: true } });
    const [alcohol] = habitImpacts({ today: TODAY, habits: ['alcohol'], checkins: [old], metrics: [makeMetrics(old.date)] });
    expect(alcohol?.yesDays).toBe(0);
  });
});
