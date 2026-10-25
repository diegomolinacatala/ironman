import assert from 'node:assert/strict';
import test from 'node:test';
import { workout } from '../testing/fakes.ts';
import type { LifeEvent, Race } from '../types.ts';
import { defaultSteps, deviceSummary, paceHint, toGarminWorkouts } from './device.ts';
import { formatDistance, formatDuration } from './labels.ts';
import { estimateTss, intensityFromEffort, lifeEventLoad, weeklyLoadHistory, weekTotals, workoutLoad } from './load.ts';
import { compatibleSport, matchActivity } from './match.ts';
import { nextRace, phaseFor } from './phase.ts';
import { commonSlots, friendBusyIntervals, myBusyIntervals, sameSportDays } from './slots.ts';
import { mergeMetricsByDate, wellnessSignals } from './wellness.ts';

const race = (date: string, distance: Race['distance'], priority: Race['priority'] = 'A'): Race => ({
  id: `race-${date}`,
  name: 'Carrera',
  date,
  distance,
  priority,
  location: null,
  goal: null,
  notes: null,
});

test('labels format durations and distances in Spanish', () => {
  assert.equal(formatDuration(45), "45'");
  assert.equal(formatDuration(75), "1h 15'");
  assert.equal(formatDuration(120), '2h');
  assert.equal(formatDistance(42195, 'run'), '42,2 km');
});

test('load estimates follow the IF² table, RPE and fixed rates', () => {
  assert.equal(estimateTss({ sport: 'bike', durationMin: 60, intensity: 'threshold' }), 81);
  assert.equal(estimateTss({ sport: 'strength', durationMin: 60, intensity: 'endurance' }), 35);
  assert.equal(workoutLoad(workout({ status: 'skipped' })), 0);
  assert.equal(workoutLoad(workout({ status: 'completed', completed: { tss: 77 } })), 77);
  assert.equal(workoutLoad(workout({ status: 'completed', durationMin: 60, completed: { rpe: 9, durationMin: 60 } })), 100);
  assert.equal(workoutLoad(workout({ tss: 40 })), 40);
  const padel: LifeEvent = { id: 'e', kind: 'padel', title: 'Pádel', startDate: '2026-10-20', endDate: '2026-10-20', startTime: null, durationMin: 90, severity: 2, bodyArea: null, notes: null };
  assert.equal(lifeEventLoad(padel), 82.5);
  assert.equal(lifeEventLoad({ ...padel, kind: 'work' }), 0);
  assert.equal(intensityFromEffort({ rpe: 2, durationMin: 30 }), 'recovery');
  assert.equal(intensityFromEffort({ tss: 100, durationMin: 60 }), 'vo2');
  assert.equal(intensityFromEffort({ durationMin: 60 }), 'endurance');
});

test('week totals and weekly history', () => {
  const ws = [
    workout({ date: '2026-10-20', status: 'completed', durationMin: 60, completed: { durationMin: 55 } }),
    workout({ date: '2026-10-21', sport: 'bike', durationMin: 90 }),
    workout({ date: '2026-10-22', sport: 'rest', durationMin: 0 }),
  ];
  const totals = weekTotals(ws);
  assert.equal(totals.sessions, 2);
  assert.equal(totals.completedMin, 55);
  assert.equal(totals.plannedMin, 150);
  assert.equal(totals.bySport.bike?.count, 1);
  const history = weeklyLoadHistory(ws, [], '2026-10-26', 2);
  assert.deepEqual(history.map((h) => h.weekStart), ['2026-10-12', '2026-10-19']);
  assert.equal(history[1].completedSessions, 1);
});

test('phase counts back from the next A race', () => {
  assert.equal(nextRace([race('2027-04-18', 'half'), race('2026-11-15', 'run_10k', 'B')], '2026-10-26')?.priority, 'A');
  assert.equal(phaseFor('2026-10-26', [race('2026-10-31', 'olympic')]).phase, 'race_week');
  assert.equal(phaseFor('2026-10-26', [race('2026-11-08', 'half')]).phase, 'taper');
  assert.equal(phaseFor('2026-10-26', [race('2026-11-15', 'half')]).phase, 'peak');
  assert.equal(phaseFor('2026-10-26', [race('2027-01-10', 'half')]).phase, 'build');
  assert.equal(phaseFor('2026-10-26', [race('2027-04-18', 'half')]).phase, 'base');
  assert.equal(phaseFor('2026-10-26', []).phase, 'base');
  assert.equal(phaseFor('2026-10-26', [race('2026-10-24', 'half')]).phase, 'recovery');
  assert.equal(phaseFor('2026-10-26', [race('2026-10-11', 'half')]).phase, 'transition');
});

test('matching respects day, sport compatibility, 50–150 % duration and start time', () => {
  const a = workout({ id: 'w-a', date: '2026-10-27', sport: 'run', durationMin: 50, startTime: '07:00' });
  const b = workout({ id: 'w-b', date: '2026-10-27', sport: 'run', durationMin: 50, startTime: '19:00' });
  const brick = workout({ id: 'w-c', date: '2026-10-27', sport: 'brick', durationMin: 120, startTime: null });
  assert.equal(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 48, startTime: '18:40' }, [a, b])?.id, 'w-b');
  assert.equal(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 20 }, [a]), null);
  assert.equal(matchActivity({ date: '2026-10-28', sport: 'run', durationMin: 50 }, [a]), null);
  assert.equal(matchActivity({ date: '2026-10-27', sport: 'bike', durationMin: 100 }, [a, brick])?.id, 'w-c');
  assert.equal(matchActivity({ date: '2026-10-27', sport: 'run', durationMin: 50 }, [a], new Set(['w-a'])), null);
  assert.equal(compatibleSport('rest', 'rest'), false);
  assert.equal(compatibleSport('swim', 'bike'), false);
});

test('common slots subtract both calendars inside training windows', () => {
  const mine = myBusyIntervals(
    [{ id: 'b', start: '2026-10-27T07:00:00Z', end: '2026-10-27T12:00:00Z', title: 'Clases' }],
    [workout({ date: '2026-10-27', startTime: '19:00', durationMin: 60 })],
    'Europe/Madrid',
  );
  const theirs = friendBusyIntervals([
    { kind: 'busy', id: null, date: '2026-10-27', startTime: '14:00', endTime: '16:00', durationMin: null, sport: null, intensity: null, title: null, status: null, jointSessionId: null },
    { kind: 'event', id: null, date: '2026-10-28', startTime: null, endTime: null, durationMin: null, sport: null, intensity: null, title: null, status: null, jointSessionId: null },
  ]);
  const slots = commonSlots({ dates: ['2026-10-27', '2026-10-28'], busy: [...mine, ...theirs], windows: [], minMinutes: 45 });
  // Clases 08:00–13:00 local (CET), friend busy 14:00–16:00, my run 19:00–20:00, 15' buffers, 13:15–13:45 too short.
  assert.deepEqual(
    slots.map((s) => `${s.date} ${s.start}-${s.end}`),
    ['2026-10-27 06:00-07:45', '2026-10-27 16:15-18:45', '2026-10-27 20:15-22:00'],
  );
  const windowed = commonSlots({ dates: ['2026-10-27'], busy: [], windows: [{ weekday: 1, start: '07:00', end: '09:00' }], minMinutes: 30 });
  assert.deepEqual(windowed.map((s) => `${s.start}-${s.end}`), ['07:00-09:00']);
});

test('same sport days pair planned workouts with the friend plan', () => {
  const mine = [workout({ id: 'mine', date: '2026-10-29', sport: 'bike' }), workout({ date: '2026-10-30', sport: 'swim' })];
  const ops = sameSportDays(mine, [
    { kind: 'workout', id: 'f1', date: '2026-10-29', startTime: '18:00', endTime: null, durationMin: 90, sport: 'brick', intensity: 'tempo', title: 'Brick', status: 'planned', jointSessionId: null },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].myWorkoutId, 'mine');
});

test('wellness signals compare the latest day with the recent baseline', () => {
  const base = { source: 'garmin' as const, sleepScore: null, bodyBattery: null, trainingReadiness: null, vo2max: null, steps: null, stressAvg: null, trainingStatus: null };
  const metrics = [
    { ...base, date: '2026-10-20', hrvMs: 60, restingHr: 48, sleepHours: 7.5 },
    { ...base, date: '2026-10-21', hrvMs: 62, restingHr: 47, sleepHours: 7.2 },
    { ...base, date: '2026-10-22', hrvMs: 48, restingHr: 56, sleepHours: 5.2 },
  ];
  const s = wellnessSignals(metrics, []);
  assert.equal(s.level, 'red');
  assert.ok(s.signals.some((x) => x.includes('VFC')));
  assert.equal(wellnessSignals([], []).level, 'unknown');
  const merged = mergeMetricsByDate([
    { ...base, date: '2026-10-22', source: 'healthkit', hrvMs: null, restingHr: 50, sleepHours: 7 },
    { ...base, date: '2026-10-22', hrvMs: 55, restingHr: null, sleepHours: null },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].hrvMs, 55);
  assert.equal(merged[0].restingHr, 50);
});

test('device export builds Garmin-like workouts with threshold targets', () => {
  const thresholds = { ftpW: 250, lthr: 170, runThresholdPaceSecPerKm: 270 };
  const bike = toGarminWorkouts(workout({ sport: 'bike', intensity: 'threshold', durationMin: 60 }), thresholds);
  assert.equal(bike.length, 1);
  const segment = (bike[0].segments as { steps: Record<string, unknown>[] }[])[0];
  assert.equal(bike[0].sport, 'CYCLING');
  assert.equal(segment.steps.length, 3);
  assert.equal(segment.steps[1].targetType, 'POWER');
  assert.equal(segment.steps[1].targetValueLow, 228);
  const intervals = toGarminWorkouts(
    workout({ sport: 'run', intensity: 'vo2', steps: [{ kind: 'warmup', durationMin: 15 }, { kind: 'work', durationMin: 3, repeat: 5, intensity: 'vo2' }] }),
    thresholds,
  );
  const steps = (intervals[0].segments as { steps: Record<string, unknown>[] }[])[0].steps;
  assert.equal(steps[1].type, 'WorkoutRepeatStep');
  assert.equal(steps[1].repeatValue, 5);
  assert.equal(toGarminWorkouts(workout({ sport: 'brick', durationMin: 120 }), {}).length, 2);
  assert.equal(toGarminWorkouts(workout({ sport: 'rest', durationMin: 0 }), {}).length, 0);
  assert.equal(defaultSteps(20, 'endurance').length, 1);
  assert.match(paceHint('run', 'endurance', thresholds) ?? '', /\/km$/);
  assert.match(deviceSummary(workout({ sport: 'run' }), thresholds), /Carrera · Rodaje Z2/);
});
