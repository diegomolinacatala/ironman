import { commonSlots, findOpportunities, freeSlots, friendBusyIntervals } from '../together';
import { intersectRanges, intervalOnDate, mergeRanges, rangesLength, subtractRanges, windowRangesOn } from '../timeRanges';
import { makeFriendItem, makeWorkout } from './fixtures';

const MON = '2026-10-26';

describe('time ranges', () => {
  test('merge, subtract, intersect', () => {
    expect(mergeRanges([{ start: 10, end: 20 }, { start: 15, end: 30 }, { start: 40, end: 40 }])).toEqual([{ start: 10, end: 30 }]);
    expect(subtractRanges([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 90 },
    ]);
    expect(intersectRanges([{ start: 0, end: 50 }], [{ start: 40, end: 60 }])).toEqual([{ start: 40, end: 50 }]);
    expect(rangesLength([{ start: 0, end: 30 }, { start: 20, end: 40 }])).toBe(40);
  });

  test('intervals spanning midnight are clipped per day', () => {
    const i = { start: '2026-10-26T22:00:00', end: '2026-10-27T01:00:00' };
    expect(intervalOnDate(i, MON)).toEqual({ start: 1320, end: 1440 });
    expect(intervalOnDate(i, '2026-10-27')).toEqual({ start: 0, end: 60 });
    expect(intervalOnDate(i, '2026-10-28')).toBeNull();
    expect(intervalOnDate({ start: 'x', end: 'y' }, MON)).toBeNull();
  });

  test('days without windows use the default day', () => {
    expect(windowRangesOn(MON, []).isDefault).toBe(true);
    const own = windowRangesOn(MON, [{ weekday: 0, start: '18:00', end: '20:00' }, { weekday: 0, start: 'bad', end: '20:00' }]);
    expect(own).toEqual({ ranges: [{ start: 1080, end: 1200 }], isDefault: false });
  });
});

describe('freeSlots', () => {
  test('window minus busy, only slots ≥ minMinutes', () => {
    const slots = freeSlots({
      date: MON,
      busy: [{ start: `${MON}T18:30:00`, end: `${MON}T19:00:00` }],
      windows: [{ weekday: 0, start: '18:00', end: '21:00' }],
      minMinutes: 45,
    });
    expect(slots).toEqual([{ date: MON, start: '19:00', end: '21:00', minutes: 120 }]);
  });

  test('custom day bounds when no windows', () => {
    const slots = freeSlots({ date: MON, busy: [], windows: [], minMinutes: 30, dayStart: '06:00', dayEnd: '08:00' });
    expect(slots).toEqual([{ date: MON, start: '06:00', end: '08:00', minutes: 120 }]);
  });
});

describe('commonSlots', () => {
  test('intersection of both athletes with travel buffer', () => {
    const slots = commonSlots({
      range: { from: MON, to: MON },
      mine: { busy: [{ start: `${MON}T09:00:00`, end: `${MON}T14:00:00` }], windows: [] },
      theirs: { busy: [{ start: `${MON}T16:00:00`, end: `${MON}T18:00:00` }], windows: [] },
      minMinutes: 60,
    });
    expect(slots).toEqual([
      { date: MON, start: '07:00', end: '08:45', minutes: 105 },
      { date: MON, start: '14:15', end: '15:45', minutes: 90 },
      { date: MON, start: '18:15', end: '22:00', minutes: 225 },
    ]);
  });
});

describe('friendBusyIntervals', () => {
  test('busy blocks and timed workouts/events; ignores untimed and skipped', () => {
    const items = [
      makeFriendItem({ kind: 'busy', id: null, startTime: '09:00', endTime: '13:00', durationMin: null, sport: null }),
      makeFriendItem({ id: 'w', startTime: '23:30', durationMin: 60 }),
      makeFriendItem({ id: 'e', kind: 'event', startTime: '19:00', durationMin: 90, sport: null }),
      makeFriendItem({ id: 'u', startTime: null }),
      makeFriendItem({ id: 's', startTime: '07:00', status: 'skipped' }),
      makeFriendItem({ kind: 'busy', id: null, startTime: '10:00', endTime: null, durationMin: null }),
    ];
    expect(friendBusyIntervals(items)).toEqual([
      { start: `${MON}T09:00:00`, end: `${MON}T13:00:00` },
      { start: `${MON}T23:30:00`, end: '2026-10-27T00:30:00' },
      { start: `${MON}T19:00:00`, end: `${MON}T20:30:00` },
    ]);
  });
});

describe('findOpportunities', () => {
  const range = { from: MON, to: '2026-11-01' };
  const slots = [{ date: MON, start: '18:00', end: '21:00', minutes: 180 }];

  test('same sport, both easy → same_session with a common start', () => {
    const mine = [makeWorkout({ id: 'm1', sport: 'run', intensity: 'endurance', durationMin: 50 })];
    const theirs = [makeFriendItem({ id: 'f1', sport: 'run', intensity: 'recovery', durationMin: 60 })];
    const [o] = findOpportunities({ range, myWorkouts: mine, friendItems: theirs, slots });
    expect(o).toEqual(expect.objectContaining({ kind: 'same_session', myWorkoutId: 'm1', friendItemId: 'f1', start: '18:00', durationMin: 50, title: 'Rodaje juntos' }));
    expect(o?.score).toBeCloseTo(0.9);
    expect(o?.reason).toMatch(/juntos/);
  });

  test('close start times keep mine; easy + hard → same_sport', () => {
    const mine = [makeWorkout({ id: 'm1', sport: 'swim', intensity: 'threshold', startTime: '19:00' })];
    const theirs = [makeFriendItem({ id: 'f1', sport: 'swim', intensity: 'recovery', startTime: '19:30' })];
    const [o] = findOpportunities({ range, myWorkouts: mine, friendItems: theirs, slots });
    expect(o?.kind).toBe('same_sport');
    expect(o?.start).toBe('19:00');
    expect(o?.reason).toMatch(/cada uno hace su serie/);
  });

  test('both quality → same_session lower score; no slot penalises', () => {
    const mine = [makeWorkout({ id: 'm1', sport: 'bike', intensity: 'vo2', durationMin: 300 })];
    const theirs = [makeFriendItem({ id: 'f1', sport: 'bike', intensity: 'threshold', durationMin: 300 })];
    const [o] = findOpportunities({ range, myWorkouts: mine, friendItems: theirs, slots });
    expect(o?.kind).toBe('same_session');
    expect(o?.start).toBeNull();
    expect(o?.score).toBeLessThan(0.75);
  });

  test('free slot opportunity when the friend has nothing that day', () => {
    const mine = [makeWorkout({ id: 'm1', sport: 'bike', durationMin: 90 })];
    const [o] = findOpportunities({ range, myWorkouts: mine, friendItems: [], slots });
    expect(o).toEqual(expect.objectContaining({ kind: 'free_slot', start: '18:00', score: 0.4 }));
  });

  test('ignores quedadas, completed, rest and out-of-range workouts; sorted by score', () => {
    const mine = [
      makeWorkout({ id: 'j', jointSessionId: 'x' }),
      makeWorkout({ id: 'c', status: 'completed' }),
      makeWorkout({ id: 'r', sport: 'rest' }),
      makeWorkout({ id: 'o', date: '2026-12-01' }),
      makeWorkout({ id: 'a', sport: 'run', durationMin: 40 }),
      makeWorkout({ id: 'b', sport: 'bike', durationMin: 60 }),
    ];
    const theirs = [makeFriendItem({ id: 'f1', sport: 'run' }), makeFriendItem({ id: 'f2', sport: 'run', jointSessionId: 'x' })];
    const ops = findOpportunities({ range, myWorkouts: mine, friendItems: theirs, slots });
    expect(ops.map((o) => o.myWorkoutId)).toEqual(['a', 'b']);
  });
});

describe('free slots around my own timed workouts (ENG-10)', () => {
  const TUE = '2026-10-27';
  const range = { from: MON, to: '2026-11-01' };
  const swim = makeWorkout({ id: 'swim', date: TUE, sport: 'swim', startTime: '18:00', durationMin: 60 });
  const mineBusy = [{ start: `${TUE}T18:00:00`, end: `${TUE}T19:00:00` }];

  test('a timed workout gets a free_slot opportunity when my own workout is the only thing in the way', () => {
    const slots = commonSlots({ range: { from: TUE, to: TUE }, mine: { busy: mineBusy, windows: [] }, theirs: { busy: [], windows: [] }, minMinutes: 45 });
    expect(slots.some((s) => s.start <= '18:00' && s.end >= '19:00')).toBe(false);
    const [o] = findOpportunities({ range, myWorkouts: [swim], friendItems: [], slots });
    expect(o).toEqual(expect.objectContaining({ kind: 'free_slot', myWorkoutId: 'swim', start: '18:00' }));
  });

  test('no opportunity when the friend is busy at that time', () => {
    const friendBusy = makeFriendItem({ kind: 'busy', id: null, date: TUE, startTime: '18:00', endTime: '19:00', durationMin: null, sport: null });
    const slots = commonSlots({
      range: { from: TUE, to: TUE },
      mine: { busy: mineBusy, windows: [] },
      theirs: { busy: friendBusyIntervals([friendBusy]), windows: [] },
      minMinutes: 45,
    });
    expect(findOpportunities({ range, myWorkouts: [swim], friendItems: [friendBusy], slots })).toEqual([]);
  });

  test('pair opportunities keep my time when it is my own gap', () => {
    const theirs = [makeFriendItem({ id: 'f1', date: TUE, sport: 'swim', intensity: 'endurance', startTime: null, durationMin: 60 })];
    const slots = commonSlots({ range: { from: TUE, to: TUE }, mine: { busy: mineBusy, windows: [] }, theirs: { busy: [], windows: [] }, minMinutes: 45 });
    const [o] = findOpportunities({ range, myWorkouts: [swim], friendItems: theirs, slots });
    expect(o?.kind).toBe('same_session');
    expect(o?.start).toBe('18:00');
  });
});
