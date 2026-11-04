import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, fakeStore, fixedNow, FRIEND, profile, USER } from '../testing/fakes.ts';
import type { JointParticipant, JointSession } from '../types.ts';
import { buildBriefingContext, promptPayload } from './context.ts';
import { BRIEFING_SYSTEM_PROMPT } from './prompt.ts';
import { NO_TOGETHER, togetherForPrompt, togetherOf } from './together.ts';

const DATE = '2026-10-24'; // Saturday
const OTHER = '33333333-3333-4333-8333-333333333333';

const person = (userId: string, displayName: string, status: JointParticipant['status']): JointParticipant => ({
  userId,
  displayName,
  status,
  workoutId: null,
});

const joint = (overrides: Partial<JointSession> = {}): JointSession => ({
  id: 'j1',
  organizerId: FRIEND,
  sport: 'run',
  date: DATE,
  startTime: '07:30',
  durationMin: 60,
  intensity: 'endurance',
  title: 'Rodaje en el Retiro',
  location: 'Casa de Campo',
  status: 'confirmed',
  participants: [person(FRIEND, 'David García', 'accepted'), person(USER, 'Diego', 'accepted')],
  ...overrides,
});

test('together: today quedada with accepted partners (first names only), title, time and place', () => {
  const t = togetherOf([joint()], USER, DATE);
  assert.deepEqual(t.today, [
    { title: 'Rodaje en el Retiro', sport: 'Carrera', startTime: '07:30', location: 'Casa de Campo', partners: ['David'], confirmed: true },
  ]);
  assert.deepEqual(t.invitations, []);
});

test('together: organizer without accepted partners yet, declined and cancelled sessions', () => {
  const mine = joint({ id: 'j2', organizerId: USER, participants: [person(USER, 'Diego', 'accepted'), person(FRIEND, 'David', 'invited')] });
  const declined = joint({ id: 'j3', participants: [person(FRIEND, 'David', 'accepted'), person(USER, 'Diego', 'declined')] });
  const cancelled = joint({ id: 'j4', status: 'cancelled' });
  const t = togetherOf([mine, declined, cancelled], USER, DATE);
  assert.equal(t.today.length, 1);
  assert.deepEqual(t.today[0].partners, []);
  assert.equal(t.today[0].confirmed, false);
  assert.deepEqual(t.invitations, []);
});

test('together: pending invitations from the organizer, from the briefing day on, in order', () => {
  const sunday = joint({
    id: 'j5',
    date: '2026-10-25',
    title: 'Tirada larga',
    location: null,
    status: 'proposed',
    participants: [person(FRIEND, 'David', 'accepted'), person(USER, 'Diego', 'invited'), person(OTHER, 'Álex', 'accepted')],
  });
  const later = joint({ id: 'j6', date: '2026-10-29', organizerId: OTHER, sport: 'bike', title: '  ', participants: [person(OTHER, 'Álex Pérez', 'accepted'), person(USER, 'Diego', 'invited')] });
  const past = joint({ id: 'j7', date: '2026-10-23', participants: [person(FRIEND, 'David', 'accepted'), person(USER, 'Diego', 'invited')] });
  const t = togetherOf([later, past, sunday], USER, DATE);
  assert.deepEqual(
    t.invitations.map((i) => [i.from, i.date, i.weekday, i.inDays, i.title, i.location]),
    [
      ['David', '2026-10-25', 'domingo', 1, 'Tirada larga', null],
      ['Álex', '2026-10-29', 'jueves', 5, 'Bici', 'Casa de Campo'],
    ],
  );
  assert.deepEqual(t.today, []);
});

test('together prompt view: absent when there is nothing social', () => {
  assert.equal(togetherForPrompt(NO_TOGETHER), null);
  assert.deepEqual(Object.keys(togetherForPrompt(togetherOf([joint()], USER, DATE)) ?? {}), ['todayJointSessions']);
});

test('briefing context: quedadas reach the model without ids or surnames; nothing social → no together key', async () => {
  const state = emptyState();
  state.profiles = [profile()];
  const empty = JSON.stringify(promptPayload(await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() })));
  assert.ok(!empty.includes('together'));

  state.joint.push(
    joint(),
    joint({ id: 'j8', date: '2026-10-31', title: 'Series', participants: [person(FRIEND, 'David García', 'accepted'), person(USER, 'Diego', 'invited')] }),
  );
  const ctx = await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() });
  const sent = JSON.stringify(promptPayload(ctx));
  assert.ok(sent.includes('"todayJointSessions"') && sent.includes('"pendingInvitations"'));
  assert.ok(sent.includes('Rodaje en el Retiro') && sent.includes('Casa de Campo') && sent.includes('"from":"David"'));
  assert.ok(!sent.includes('García'), 'only first names');
  assert.ok(!sent.includes(FRIEND) && !sent.includes(USER) && !sent.includes('"j1"'), 'no ids');
  assert.match(BRIEFING_SYSTEM_PROMPT, /todayJointSessions/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /pendingInvitations/);
});
