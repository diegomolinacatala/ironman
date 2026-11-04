import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { claudeReturning, coachJob as job, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { FRIEND, fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import { runCoachJob } from './job.ts';
import { messageText } from './ports.ts';
import type { ClaudeRequest } from './ports.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput } from './output.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';
import { toCoachQuedada } from './quedada.ts';

const TODAY = '2026-10-24';
const WEEK = '2026-10-26';
const OTHER = '33333333-3333-4333-8333-333333333333';

const RAW = {
  friend_id: FRIEND,
  date: '2026-11-01',
  start_time: '08:00',
  sport: 'run',
  duration_min: 60,
  intensity: 'endurance',
  title: '  Rodaje   juntos ',
  location: 'Parque del Retiro',
  reason: 'Los dos tenéis libre el domingo por la mañana.',
};

const CHECK = { friendIds: [FRIEND], friends: [{ friendId: FRIEND, name: 'David' }], today: TODAY, weekStart: WEEK };

test('quedada: valid suggestion → camelCase with the friend name from the context', () => {
  assert.deepEqual(toCoachQuedada(RAW, CHECK), {
    ok: true,
    value: {
      friendId: FRIEND,
      friendName: 'David',
      sport: 'run',
      date: '2026-11-01',
      startTime: '08:00',
      durationMin: 60,
      intensity: 'endurance',
      title: 'Rodaje juntos',
      location: 'Parque del Retiro',
      reason: 'Los dos tenéis libre el domingo por la mañana.',
    },
  });
  const loose = toCoachQuedada({ ...RAW, start_time: null, location: '   ', extra: 'ignored' }, CHECK);
  assert.ok(loose.ok);
  assert.equal(loose.value.startTime, null);
  assert.equal(loose.value.location, null);
});

test('quedada: friend must be in the request and the context; dates, sport, duration, title, time and location are checked', () => {
  const bad: [string, Record<string, unknown>, typeof CHECK?][] = [
    ['friend not requested', RAW, { ...CHECK, friendIds: [OTHER] }],
    ['friend not in context', { ...RAW, friend_id: OTHER }, { ...CHECK, friendIds: [FRIEND, OTHER] }],
    ['past date', { ...RAW, date: '2026-10-23' }],
    ['after the window', { ...RAW, date: '2026-11-09' }],
    ['impossible date', { ...RAW, date: '2026-02-30' }],
    ['rest', { ...RAW, sport: 'rest' }],
    ['unknown sport', { ...RAW, sport: 'padel' }],
    ['too short', { ...RAW, duration_min: 4 }],
    ['too long', { ...RAW, duration_min: 721 }],
    ['not integer', { ...RAW, duration_min: 30.5 }],
    ['empty title', { ...RAW, title: '   ' }],
    ['long title', { ...RAW, title: 'x'.repeat(121) }],
    ['bad time', { ...RAW, start_time: '8:00' }],
    ['seconds', { ...RAW, start_time: '08:00:00' }],
    ['long location', { ...RAW, location: 'x'.repeat(201) }],
    ['bad intensity', { ...RAW, intensity: 'easy' }],
    ['missing field', { ...RAW, reason: undefined }],
  ];
  for (const [label, raw, check] of bad) assert.equal(toCoachQuedada(raw, check ?? CHECK).ok, false, label);
  assert.equal(toCoachQuedada('nope', CHECK).ok, false);
  assert.ok(toCoachQuedada({ ...RAW, date: TODAY }, CHECK).ok, 'today is allowed');
  assert.ok(toCoachQuedada({ ...RAW, date: '2026-11-08' }, CHECK).ok, 'last day of the window is allowed');
});

test('structured output publishes quedada as a nullable object; weaker models may omit it', () => {
  const schema = COACH_OUTPUT_JSON_SCHEMA as { properties: { quedada: { anyOf: { type: string; required?: string[] }[] } } };
  const variants = schema.properties.quedada.anyOf;
  assert.deepEqual(variants.map((v) => v.type), ['object', 'null']);
  assert.deepEqual(variants[0].required, ['friend_id', 'date', 'start_time', 'sport', 'duration_min', 'intensity', 'title', 'location', 'reason']);
  assert.equal(parseCoachOutput(JSON.stringify({ reply: 'Hola' }))?.quedada, null);
  assert.deepEqual(parseCoachOutput(JSON.stringify({ reply: 'Hola', quedada: RAW }))?.quedada, RAW);
  assert.match(COACH_SYSTEM_PROMPT, /quedada: si el atleta quiere entrenar con un amigo/);
  assert.match(COACH_SYSTEM_PROMPT, /seis claves/);
});

function output(overrides: Record<string, unknown>): string {
  return JSON.stringify({ reply: 'Te propongo un rodaje con David el domingo.', summary: '', changes: [], memory: [], life_event: null, ...overrides });
}

function stateWithFriend(): FakeState {
  const state = stateWithWeek();
  state.friends.set(USER, [{ friendId: FRIEND, username: 'david', displayName: 'David' }]);
  state.friendWeeks.set(FRIEND, [
    { kind: 'workout', id: null, date: '2026-10-31', startTime: '09:00', endTime: null, durationMin: 90, sport: 'bike', intensity: 'endurance', title: null, status: 'planned', jointSessionId: null },
  ]);
  return state;
}

test('runCoachJob stores the suggested quedada in extras and sends the friends block to the model', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(
    { reader: fakeStore(stateWithFriend()), store: rec.store, claude: claudeReturning({ text: output({ quedada: RAW }) }, seen), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat', message: 'quiero rodar con David este finde', friendIds: [FRIEND] }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.equal(rec.jobs[0].extras?.quedada?.friendName, 'David');
  assert.equal(rec.jobs[0].extras?.quedada?.title, 'Rodaje juntos');
  assert.match(messageText(seen[0].messages[0]), /Calendario de amigos/);
});

test('runCoachJob drops a quedada for a friend outside the request, outside a chat, or malformed (job still done)', async () => {
  const cases = [
    { request: { mode: 'chat' as const, message: 'quiero rodar con alguien' }, quedada: RAW },
    { request: { mode: 'replan' as const, message: 'replan', friendIds: [FRIEND] }, quedada: RAW },
    { request: { mode: 'chat' as const, message: 'con David', friendIds: [FRIEND] }, quedada: { ...RAW, sport: 'rest' } },
    { request: { mode: 'chat' as const, message: 'con David', friendIds: [FRIEND] }, quedada: 'el domingo' },
  ];
  for (const { request, quedada } of cases) {
    const rec = runningRecorder();
    await runCoachJob(
      { reader: fakeStore(stateWithFriend()), store: rec.store, claude: claudeReturning({ text: output({ quedada }) }), now: fixedNow, logger: silentLogger },
      job(request),
    );
    assert.equal(rec.jobs[0].status, 'done');
    assert.equal(rec.jobs[0].extras?.quedada, null);
  }
});
