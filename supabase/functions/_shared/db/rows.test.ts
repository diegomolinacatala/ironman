import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleJointSessions,
  mapAcceptedFriends,
  mapFriendWeekItem,
  mapLifeEvent,
  mapMetrics,
  mapProfile,
  mapRace,
  mapWorkout,
} from './rows.ts';

test('mapWorkout converts snake_case rows and normalizes times and numerics', () => {
  const w = mapWorkout({
    id: 'w1',
    user_id: 'u1',
    date: '2026-10-27',
    start_time: '07:30:00',
    sport: 'run',
    title: 'Series',
    description: null,
    duration_min: 60,
    distance_m: null,
    intensity: 'threshold',
    tss: '72.5',
    steps: [{ kind: 'work', durationMin: 5, repeat: 6 }],
    status: 'planned',
    completed: null,
    source: 'claude',
    is_key: true,
    joint_session_id: null,
    external_id: null,
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-21T10:00:00Z',
  });
  assert.equal(w.startTime, '07:30');
  assert.equal(w.tss, 72.5);
  assert.equal(w.isKey, true);
  assert.equal(w.steps.length, 1);
  const weird = mapWorkout({ sport: 'curling', intensity: 'ultra', status: 'nope', steps: 'x' });
  assert.equal(weird.sport, 'other');
  assert.equal(weird.intensity, 'endurance');
  assert.equal(weird.status, 'planned');
  assert.deepEqual(weird.steps, []);
});

test('profile, race, event and metrics mappers apply safe defaults', () => {
  const p = mapProfile({
    id: 'u1',
    username: 'diego',
    display_name: 'Diego',
    sports: ['swim'],
    thresholds: { ftpW: 250 },
    availability: { weeklyHoursTarget: 10, restDay: null, longSessionDays: [5, 6, 9], windows: [{ weekday: 1, start: '07:00:00', end: '09:00' }, { weekday: 8, start: 'x', end: 'y' }], poolDays: [1] },
    notification_prefs: { social: false },
    timezone: '',
  });
  assert.equal(p.availability.restDay, null);
  assert.deepEqual(p.availability.longSessionDays, [5, 6]);
  assert.deepEqual(p.availability.windows, [{ weekday: 1, start: '07:00', end: '09:00' }]);
  assert.equal(p.timezone, 'Europe/Madrid');
  assert.equal(mapProfile({}).availability.weeklyHoursTarget, 8);
  assert.equal(mapRace({ id: 'r', name: 'X', date: '2027-04-18', distance: 'half', priority: 'A' }).distance, 'half');
  const e = mapLifeEvent({ id: 'e', kind: 'padel', title: 'Pádel', start_date: '2026-10-28', end_date: '2026-10-28', start_time: '20:00:00', severity: 3 });
  assert.equal(e.startTime, '20:00');
  assert.equal(e.severity, 3);
  const m = mapMetrics({ date: '2026-10-24', source: 'garmin', hrv_ms: '61.0', resting_hr: null, steps: 1000 });
  assert.equal(m.hrvMs, 61);
  assert.equal(m.restingHr, null);
});

test('friend rows: accepted friends only and masked week items', () => {
  const friends = mapAcceptedFriends([
    { friend_id: 'f1', status: 'accepted', username: 'alex', display_name: 'Álex' },
    { friend_id: 'f2', status: 'pending', username: 'paco', display_name: 'Paco' },
  ]);
  assert.deepEqual(friends, [{ friendId: 'f1', username: 'alex', displayName: 'Álex' }]);
  const busy = mapFriendWeekItem({ kind: 'busy', id: null, date: '2026-10-28', start_time: '09:00:00', end_time: '14:00:00' });
  assert.deepEqual(busy, {
    kind: 'busy',
    id: null,
    date: '2026-10-28',
    startTime: '09:00',
    endTime: '14:00',
    durationMin: null,
    sport: null,
    intensity: null,
    title: null,
    status: null,
    jointSessionId: null,
  });
});

test('assembleJointSessions attaches participants with display names', () => {
  const sessions = assembleJointSessions(
    [{ id: 's1', organizer_id: 'f1', sport: 'bike', date: '2026-10-31', start_time: '09:00:00', duration_min: 150, intensity: 'endurance', title: 'Grupeta', location: null, status: 'confirmed' }],
    [
      { session_id: 's1', user_id: 'f1', status: 'accepted', workout_id: null },
      { session_id: 's1', user_id: 'u1', status: 'invited', workout_id: 'w1' },
    ],
    [{ id: 'f1', display_name: 'Álex' }, { id: 'u1', display_name: 'Diego' }],
  );
  assert.equal(sessions[0].startTime, '09:00');
  assert.deepEqual(sessions[0].participants.map((p) => `${p.displayName}:${p.status}`), ['Álex:accepted', 'Diego:invited']);
});
