/**
 * Imprevisto re-plan reliability: untimed sessions vs timed events, real
 * start times without training windows, true swaps, multi-day and timed
 * events without duration, local failures surfaced, backward moves and the
 * week plan (Plan → General).
 */
import { applyPlanChanges } from '../changes';
import { eventDurationMin, eventRangesOn, untimedEventMinutesOn } from '../freeTime';
import { replanForEvent, replanForReadiness, replanMissed } from '../replanner';
import { findMoveTarget, makeCtx, record, startPlan } from '../replanCore';
import type { Readiness } from '../readiness';
import type { PlanChange, WeekPlan, Workout } from '../types';
import { makeBusy, makeEvent, makeProfile, makeWorkout } from './fixtures';

const TODAY = '2026-10-27'; // Tuesday
const profile = makeProfile();

function changeFor(changes: PlanChange[], id: string): PlanChange | undefined {
  return changes.find((c) => c.op !== 'add' && c.workoutId === id);
}

function applyAll(workouts: Workout[], changes: PlanChange[]) {
  let n = 0;
  return applyPlanChanges(workouts, changes, { userId: 'me', now: '2026-10-27T08:00:00', newId: () => `n${(n += 1)}` });
}

function social(overrides: Parameters<typeof makeEvent>[0]) {
  return makeEvent({ kind: 'social', severity: 1, title: 'Cena de empresa', ...overrides });
}

describe('freeTime', () => {
  test('timed events take their slot every day they last, with a default duration', () => {
    const e = social({ startDate: '2026-10-28', endDate: '2026-10-30', startTime: '18:00', durationMin: null });
    expect(eventDurationMin(e)).toBe(90);
    expect(eventRangesOn([e], '2026-10-29')).toEqual([{ start: 18 * 60, end: 19 * 60 + 30 }]);
    expect(eventRangesOn([e], '2026-10-31')).toEqual([]);
    expect(eventDurationMin({ kind: 'other', durationMin: null })).toBe(60);
  });

  test('untimed events still take minutes of the day', () => {
    const work = makeEvent({ kind: 'work', startDate: '2026-10-28', startTime: null, durationMin: null });
    const stress = makeEvent({ kind: 'stress', startDate: '2026-10-28', startTime: null, durationMin: null });
    expect(untimedEventMinutesOn([work, stress], '2026-10-28')).toBe(90);
  });
});

describe('defect 1 — untimed sessions vs a timed imprevisto', () => {
  test('no gap left for the untimed session: it moves to another day', () => {
    const bike = makeWorkout({ id: 'bike', date: '2026-10-28', sport: 'bike', durationMin: 90, title: 'Bici Z2' });
    const busy = [makeBusy('2026-10-28T07:00:00', '2026-10-28T18:00:00')];
    const event = social({ startDate: '2026-10-28', startTime: '18:30', durationMin: 180 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [bike], profile, busyBlocks: busy, event });
    const c = changeFor(r.changes, 'bike');
    expect(c?.op).toBe('move');
    if (c?.op === 'move') expect(c.toDate).not.toBe('2026-10-28');
    expect(r.summary).not.toMatch(/ya encaja/);
  });

  test('a gap long enough for the session but not its margin: re-timed the same day with a real time', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 60, title: 'Rodaje' });
    const busy = [makeBusy('2026-10-28T07:00:00', '2026-10-28T14:00:00')];
    const event = social({ startDate: '2026-10-28', startTime: '14:00', durationMin: 420 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [run], profile, busyBlocks: busy, event });
    const c = changeFor(r.changes, 'run');
    expect(c?.op).toBe('move');
    if (c?.op === 'move') {
      expect(c.toDate).toBe('2026-10-28');
      expect(c.toStartTime).toBe('21:00');
    }
  });

  test('a day with plenty of room keeps the untimed session untouched', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 60 });
    const event = social({ startDate: '2026-10-28', startTime: '20:00', durationMin: 120 });
    expect(replanForEvent({ today: TODAY, weekWorkouts: [run], profile, event }).changes).toEqual([]);
  });

  test('a session that did not fit before the imprevisto is not blamed on it', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 60 });
    const busy = [makeBusy('2026-10-28T07:00:00', '2026-10-28T21:30:00')];
    const event = social({ startDate: '2026-10-28', startTime: '21:30', durationMin: 30 });
    expect(changeFor(replanForEvent({ today: TODAY, weekWorkouts: [run], profile, busyBlocks: busy, event }).changes, 'run')).toBeUndefined();
  });
});

describe('defect 2 — re-timing on the same day without training windows', () => {
  test('a timed clash gets a real time in the largest free gap', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 60, startTime: '18:00' });
    const busy = [makeBusy('2026-10-28T07:00:00', '2026-10-28T15:00:00')];
    const event = social({ startDate: '2026-10-28', startTime: '17:30', durationMin: 90 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [run], profile, busyBlocks: busy, event });
    const c = changeFor(r.changes, 'run');
    expect(c?.op).toBe('move');
    if (c?.op === 'move') {
      expect(c.toDate).toBe('2026-10-28');
      expect(c.toStartTime).toBe('19:00');
    }
  });
});

describe('defect 3 — moves into an easy session swap them', () => {
  const red: Readiness = { score: 20, level: 'red', factors: [], recommendation: '' };

  test('the easy session takes the freed day instead of being deleted', () => {
    const key = makeWorkout({ id: 'key', date: TODAY, sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series', isKey: true });
    const easy = makeWorkout({ id: 'easy', date: '2026-10-28', sport: 'bike', durationMin: 40, title: 'Bici suave' });
    const thu = makeWorkout({ id: 'thu', date: '2026-10-29', sport: 'swim', durationMin: 45, title: 'Natación', isKey: true });
    const fri = makeWorkout({ id: 'fri', date: '2026-10-30', sport: 'bike', durationMin: 60, title: 'Bici', isKey: true });
    const week = [key, easy, thu, fri];
    const r = replanForReadiness({ today: TODAY, weekWorkouts: week, profile, readiness: red });
    expect(r.changes.some((c) => c.op === 'delete')).toBe(false);
    const k = changeFor(r.changes, 'key');
    const e = changeFor(r.changes, 'easy');
    expect(k?.op).toBe('move');
    expect(e?.op).toBe('move');
    if (k?.op === 'move') expect(k.toDate).toBe('2026-10-28');
    if (e?.op === 'move') expect(e.toDate).toBe(TODAY);
    expect(e?.reason).toMatch(/Intercambio/);
    expect(applyAll(week, r.changes).failed).toEqual([]);
  });

  test('only dropped as a last resort, and the summary says so', () => {
    const today = '2026-10-28';
    const missed = makeWorkout({ id: 'missed', date: TODAY, sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series', isKey: true });
    const easy = makeWorkout({ id: 'easy', date: today, sport: 'bike', durationMin: 40, title: 'Bici suave' });
    const others = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((date, i) =>
      makeWorkout({ id: `o${i}`, date, sport: 'swim', durationMin: 45, title: `Natación ${i}`, isKey: true }),
    );
    const week = [missed, easy, ...others];
    const r = replanMissed({ today, weekWorkouts: week, profile, missed: [missed] });
    expect(changeFor(r.changes, 'easy')?.op).toBe('delete');
    expect(changeFor(r.changes, 'missed')?.op).toBe('move');
    expect(r.summary).toMatch(/He quitado «Bici suave»/);
  });
});

describe('defect 4 — every kind, timed without duration, multi-day', () => {
  test('timed event without durationMin uses a default duration', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 45, startTime: '18:30' });
    const event = social({ startDate: '2026-10-28', startTime: '18:00', durationMin: null });
    const c = changeFor(replanForEvent({ today: TODAY, weekWorkouts: [run], profile, event }).changes, 'run');
    expect(c?.op).toBe('move');
  });

  test('kind "other" with a time clashes too', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 45, startTime: '10:00' });
    const event = makeEvent({ kind: 'other', title: 'Médico', startDate: '2026-10-28', startTime: '10:00', durationMin: null });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [run], profile, event });
    expect(changeFor(r.changes, 'run')?.op).toBe('move');
  });

  test('a multi-day timed event clashes on every day', () => {
    const thu = makeWorkout({ id: 'thu', date: '2026-10-29', sport: 'run', durationMin: 45, startTime: '18:30' });
    const fri = makeWorkout({ id: 'fri', date: '2026-10-30', sport: 'bike', durationMin: 60, startTime: '18:30' });
    const event = social({ startDate: '2026-10-28', endDate: '2026-10-30', startTime: '18:00', durationMin: 120 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [thu, fri], profile, event });
    for (const id of ['thu', 'fri']) {
      const c = changeFor(r.changes, id);
      expect(c?.op).toBe('move');
      if (c?.op === 'move') expect(c.toStartTime).not.toBe('18:30');
    }
  });

  test('an untimed work day that fills the day moves the session as well as shortening it', () => {
    const bike = makeWorkout({ id: 'bike', date: '2026-10-28', sport: 'bike', durationMin: 90, title: 'Bici Z2' });
    const work = makeEvent({ kind: 'work', severity: 2, title: 'Feria', startDate: '2026-10-28', startTime: null, durationMin: 840 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [bike], profile, event: work });
    const c = changeFor(r.changes, 'bike');
    expect(c?.op).toBe('update');
    if (c?.op === 'update') {
      expect(c.patch.durationMin).toBeLessThan(90);
      expect(c.patch.date).toBeDefined();
      expect(c.patch.date).not.toBe('2026-10-28');
    }
    expect(c?.reason).toMatch(/\.$/);
    expect(applyAll([bike], r.changes).failed).toEqual([]);
  });
});

describe('defect 6 — failures surfaced, moves search backward too', () => {
  test('a change that does not apply locally is reported, not silently dropped', () => {
    const ctx = makeCtx({ today: TODAY, weekWorkouts: [], profile });
    const plan = record(startPlan(ctx.input), { op: 'move', workoutId: 'ghost', toDate: '2026-10-28', reason: 'Prueba.' });
    expect(plan.changes).toEqual([]);
    expect(plan.failures).toHaveLength(1);
    expect(plan.notes.join(' ')).toMatch(/No he podido preparar el cambio/);
  });

  test('when every later day is taken, the target is an earlier free day (never in the past)', () => {
    const today = '2026-10-27';
    const w = makeWorkout({ id: 'w', date: '2026-10-30', sport: 'run', durationMin: 45 });
    const after = ['2026-10-31', '2026-11-01', '2026-11-02'].map((date, i) => makeWorkout({ id: `a${i}`, date, isKey: true, sport: 'bike' }));
    const ctx = makeCtx({ today, weekWorkouts: [w, ...after], profile });
    const target = findMoveTarget(startPlan(ctx.input), ctx, w, { windowDays: 3 });
    expect(target?.date).toBe('2026-10-29');
    const late = makeCtx({ today: '2026-10-30', weekWorkouts: [w, ...after], profile });
    expect(findMoveTarget(startPlan(late.input), late, w, { windowDays: 3 })).toBeNull();
  });
});

describe('defect 7 — the week plan (Plan → General) reaches the event re-plan', () => {
  test('in a semana libre an easy session that no longer fits is not recovered', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28', sport: 'run', durationMin: 60, title: 'Rodaje suave' });
    const busy = [makeBusy('2026-10-28T07:00:00', '2026-10-28T18:00:00')];
    const event = social({ startDate: '2026-10-28', startTime: '18:00', durationMin: 240 });
    const base = { today: TODAY, weekWorkouts: [run], profile, busyBlocks: busy, event };
    expect(changeFor(replanForEvent(base).changes, 'run')?.op).toBe('move');
    const weekPlan: WeekPlan = { weekStart: '2026-10-26', kind: 'rest', targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-10-25T10:00:00' };
    const r = replanForEvent({ ...base, weekPlan });
    expect(changeFor(r.changes, 'run')?.op).toBe('delete');
    expect(r.summary).toMatch(/no se recupera/);
  });
});
