import { addDays } from '../dates';
import { replanForStressSleep } from '../replanStressSleep';
import {
  BEDTIME,
  clockOf,
  roughDuration,
  stressSleepSignal,
  stressSleepWeekFactor,
  suggestedBedtime,
  usualBedtime,
  type StressSleepSignal,
} from '../stressSleep';
import type { DailyMetrics } from '../types';
import { makeCheckin, makeEvent, makeMetrics, makeProfile, makeWorkout } from './fixtures';

const TODAY = '2026-10-27'; // Tuesday
/** Local minutes = UTC minutes: the tests do not depend on the machine's zone. */
const utcMinutes = (iso: string) => {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** 28 calm nights before the window: stress 30, 7 h 30, score 80, 20' awake, bed at 23:00. */
function baseline(): DailyMetrics[] {
  return Array.from({ length: 28 }, (_, i) => {
    const date = addDays(TODAY, -3 - i);
    return makeMetrics(date, { sleepAwakeMin: 20, sleepStart: `${addDays(date, -1)}T23:00:00Z` });
  });
}

/** The night that ends on `date` and the stress of the day before it. */
function night(date: string, overrides: Partial<DailyMetrics> = {}, stressBefore = 30): DailyMetrics[] {
  return [makeMetrics(addDays(date, -1), { stressAvg: stressBefore, sleepHours: null, sleepScore: null }), makeMetrics(date, { sleepAwakeMin: 20, stressAvg: null, sleepStart: `${addDays(date, -1)}T23:00:00Z`, ...overrides })];
}

/** Rows by date: later rows fill in their non-null fields (one source). */
function rows(...lists: DailyMetrics[][]): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>();
  for (const m of lists.flat()) {
    const filled = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined));
    byDate.set(m.date, { ...(byDate.get(m.date) ?? m), ...filled } as DailyMetrics);
  }
  return [...byDate.values()];
}

function signal(metrics: DailyMetrics[], extra: Partial<Parameters<typeof stressSleepSignal>[0]> = {}): StressSleepSignal | null {
  return stressSleepSignal({ today: TODAY, metrics, localMinutes: utcMinutes, ...extra });
}

/** Stressful days (55) before the nights of today and yesterday, with 1 h less sleep. */
function stressedTwoNights(): DailyMetrics[] {
  return rows(baseline(), night(addDays(TODAY, -2)), night(addDays(TODAY, -1), { sleepHours: 6.5 }, 55), night(TODAY, { sleepHours: 6.5 }, 55));
}

describe('stressSleepSignal', () => {
  test('watch stress and 1 h less sleep two nights out of three: moderate, two days', () => {
    const s = signal(stressedTwoNights());
    expect(s).not.toBeNull();
    expect(s?.level).toBe('moderate');
    expect(s?.flaggedNights).toBe(2);
    expect(s?.stressDays).toBe(2);
    expect(s?.worse).toEqual({ kind: 'hours', amount: 60 });
    expect(s?.easeDays).toBe(2);
    expect(s?.headline).toBe('Estrés alto 2 días y dormiste 1 h menos de lo habitual');
    expect(s?.message).toBe('Estrés alto 2 días y dormiste 1 h menos de lo habitual: hoy suave y acuéstate antes.');
    expect(s?.usualBedtimeMin).toBe(23 * 60);
  });

  test('one bad night is not enough', () => {
    const metrics = rows(baseline(), night(addDays(TODAY, -2)), night(addDays(TODAY, -1)), night(TODAY, { sleepHours: 5.5 }, 60));
    expect(signal(metrics)).toBeNull();
  });

  test('stress without worse sleep (or worse sleep without stress) stays silent', () => {
    const calmSleep = rows(baseline(), night(addDays(TODAY, -1), {}, 60), night(TODAY, {}, 60));
    expect(signal(calmSleep)).toBeNull();
    const noStress = rows(baseline(), night(addDays(TODAY, -1), { sleepHours: 6 }), night(TODAY, { sleepHours: 6 }));
    expect(signal(noStress)).toBeNull();
  });

  test('no data, or no baseline for the sleep, means no signal', () => {
    expect(signal([])).toBeNull();
    const onlyWindow = rows(night(addDays(TODAY, -1), { sleepHours: 5 }, 70), night(TODAY, { sleepHours: 5 }, 70));
    expect(signal(onlyWindow)).toBeNull();
  });

  test('three flagged nights make it high and three days', () => {
    const metrics = rows(baseline(), night(addDays(TODAY, -2), { sleepScore: 65 }, 50), night(addDays(TODAY, -1), { sleepScore: 66 }, 52), night(TODAY, { sleepScore: 64 }, 55));
    const s = signal(metrics);
    expect(s?.level).toBe('high');
    expect(s?.easeDays).toBe(3);
    expect(s?.worse.kind).toBe('score');
    expect(s?.headline).toBe('Estrés alto 3 días y tu sueño puntúa 15 puntos menos de lo habitual');
    expect(s?.advice).toContain('respiración lenta');
  });

  test('the check-in stress counts, and the check-in hours fill a night the watch did not record', () => {
    const metrics = rows(baseline(), night(addDays(TODAY, -1), { sleepHours: 6.25 }), night(TODAY, { sleepHours: null }));
    const checkins = [
      makeCheckin({ date: addDays(TODAY, -2), stress: 4 }),
      makeCheckin({ date: addDays(TODAY, -1), stress: 5 }),
      makeCheckin({ date: TODAY, stress: 4, sleepHours: 6 }),
    ];
    const s = signal(metrics, { checkins });
    expect(s?.flaggedNights).toBe(2);
    expect(s?.worse.kind).toBe('hours');
  });

  test('an exam period makes it high and says so', () => {
    const lifeEvents = [makeEvent({ kind: 'exam', startDate: addDays(TODAY, 1), endDate: addDays(TODAY, 1), title: 'Examen' })];
    const metrics = rows(baseline(), night(addDays(TODAY, -1), { sleepAwakeMin: 50 }, 55), night(TODAY, { sleepAwakeMin: 45 }));
    const s = signal(metrics, { lifeEvents });
    expect(s?.exam).toBe(true);
    expect(s?.level).toBe('high');
    expect(s?.headline).toMatch(/^Exámenes y estrés alto 2 días y pasas/);
  });

  test('a later bedtime counts as worse sleep', () => {
    const late = (date: string) => ({ sleepStart: `${date}T00:15:00Z` });
    const metrics = rows(baseline(), night(addDays(TODAY, -1), late(addDays(TODAY, -1)), 58), night(TODAY, late(TODAY), 58));
    const s = signal(metrics);
    expect(s?.worse).toEqual({ kind: 'later', amount: 75 });
    expect(s?.headline).toContain('te acuestas 1 h 15 min más tarde de lo habitual');
  });

  test('without a stress baseline only clearly high watch stress counts', () => {
    const noStress = baseline().map((m) => ({ ...m, stressAvg: null }));
    const mild = rows(noStress, night(addDays(TODAY, -1), { sleepHours: 6 }, 40), night(TODAY, { sleepHours: 6 }, 45));
    expect(signal(mild)).toBeNull();
    const high = rows(noStress, night(addDays(TODAY, -1), { sleepHours: 6 }, 52), night(TODAY, { sleepHours: 6 }, 60));
    expect(signal(high)?.flaggedNights).toBe(2);
  });
});

describe('bedtime', () => {
  test('usual bedtime is the median of recent nights across midnight, else 23:00', () => {
    const metrics = ['23:30', '00:10', '23:50', '00:30', '23:40'].map((t, i) => {
      const date = addDays(TODAY, -i);
      const startDay = t.startsWith('00') ? date : addDays(date, -1);
      return makeMetrics(date, { sleepStart: `${startDay}T${t}:00Z` });
    });
    expect(clockOf(usualBedtime({ today: TODAY, metrics, localMinutes: utcMinutes }))).toBe('23:50');
    expect(usualBedtime({ today: TODAY, metrics: metrics.slice(0, 3), localMinutes: utcMinutes })).toBe(BEDTIME.defaultMin);
  });

  test('the suggested bedtime is 30 min earlier than usual', () => {
    expect(clockOf(suggestedBedtime({ usualBedtimeMin: 15 }))).toBe('23:45');
    expect(roughDuration(50)).toBe('45 min');
    expect(roughDuration(95)).toBe('1 h 30 min');
  });
});

describe('stressSleepWeekFactor', () => {
  test('moderate −10 %, high −15 %, an exam week a further −10 %', () => {
    expect(stressSleepWeekFactor(null, false)).toBe(1);
    expect(stressSleepWeekFactor({ level: 'moderate' }, false)).toBe(0.9);
    expect(stressSleepWeekFactor({ level: 'high' }, false)).toBe(0.85);
    expect(stressSleepWeekFactor({ level: 'high' }, true)).toBe(0.9);
  });
});

describe('replanForStressSleep', () => {
  const profile = makeProfile();
  const week = () => [
    makeWorkout({ id: 'tue-thr', date: TODAY, sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series umbral', isKey: true }),
    makeWorkout({ id: 'tue-swim', date: TODAY, sport: 'swim', durationMin: 45, title: 'Natación técnica' }),
    makeWorkout({ id: 'wed-tempo', date: addDays(TODAY, 1), sport: 'bike', intensity: 'tempo', durationMin: 75, title: 'Bici tempo' }),
    makeWorkout({ id: 'wed-joint', date: addDays(TODAY, 1), sport: 'run', durationMin: 60, title: 'Rodaje con Álex', jointSessionId: 'j1' }),
    makeWorkout({ id: 'thu-bike', date: addDays(TODAY, 2), sport: 'bike', durationMin: 60, title: 'Bici fondo' }),
  ];
  const base = stressSleepSignal({ today: TODAY, metrics: stressedTwoNights(), localMinutes: utcMinutes }) as StressSleepSignal;

  test('moderate: keeps the key session, eases the other quality one, shortens the rest, leaves the quedada', () => {
    const r = replanForStressSleep({ today: TODAY, weekWorkouts: week(), profile, signal: base });
    const ids = r.changes.flatMap((c) => (c.op === 'add' ? [] : [c.workoutId]));
    expect(ids).not.toContain('tue-thr');
    expect(ids).not.toContain('wed-joint');
    expect(ids).not.toContain('thu-bike'); // day 3 is outside a moderate window
    const tempo = r.changes.find((c) => c.op === 'update' && c.workoutId === 'wed-tempo');
    expect(tempo?.op === 'update' && tempo.patch.intensity).toBe('endurance');
    const swim = r.changes.find((c) => c.op === 'update' && c.workoutId === 'tue-swim');
    expect(swim?.op === 'update' && swim.patch.durationMin).toBe(35);
    expect(r.summary).toContain('Estrés alto 2 días');
    expect(r.summary).toContain('Mantengo «Series umbral»');
  });

  test('high: three days and a slightly shorter key session', () => {
    const r = replanForStressSleep({ today: TODAY, weekWorkouts: week(), profile, signal: { ...base, level: 'high', easeDays: 3 } });
    const key = r.changes.find((c) => c.op === 'update' && c.workoutId === 'tue-thr');
    expect(key?.op === 'update' && key.patch.durationMin).toBe(45);
    expect(r.changes.some((c) => c.op === 'update' && c.workoutId === 'thu-bike')).toBe(true);
  });

  test('nothing to ease: the summary says so', () => {
    const r = replanForStressSleep({ today: TODAY, weekWorkouts: [], profile, signal: base });
    expect(r.changes).toHaveLength(0);
    expect(r.summary).toContain('no hace falta cambiar nada');
  });
});
