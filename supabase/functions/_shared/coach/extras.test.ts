import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { claudeReturning, coachJob as job, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { fakeStore, fixedNow, profile, USER } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import { runCoachJob } from './job.ts';
import { isDuplicateLifeEvent, toLifeEventInsert } from './life-event.ts';
import { mayWriteExtras } from './extras.ts';
import { MAX_COACH_NOTES_CHARS, mergeCoachNotes, normalizeMemory } from './memory.ts';
import { buildCoachMessages } from './messages.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput } from './output.ts';
import type { ClaudeRequest } from './ports.ts';
import { messageText } from './ports.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';
import { parseCoachRequest } from './request.ts';
import { buildPlanningContext } from '../planning/context.ts';

const TODAY = '2026-10-24';

const KNEE = {
  kind: 'injury',
  title: 'Molestia en la rodilla',
  start_date: TODAY,
  end_date: null,
  severity: 2,
  body_area: 'knee',
  notes: 'Duele al bajar escaleras',
};

test('memory: bullets stripped, duplicates and over-long facts dropped, at most 3', () => {
  assert.deepEqual(
    normalizeMemory(['- Prefiere nadar por la mañana', 'prefiere nadar por la mañana.', '', 'x'.repeat(141), 'Los martes no puede por la tarde', 'Tiene piscina los lunes', 'Cuarto']),
    ['Prefiere nadar por la mañana', 'Los martes no puede por la tarde', 'Tiene piscina los lunes'],
  );
});

test('coach notes: new facts appended as "- " lines, deduplicated ignoring case and accents', () => {
  const first = mergeCoachNotes(null, ['Prefiere nadar por la mañana']);
  assert.deepEqual(first, { notes: '- Prefiere nadar por la mañana', added: ['Prefiere nadar por la mañana'], known: [], skipped: [] });
  const second = mergeCoachNotes('Lesión de rodilla en 2025.\n- Prefiere nadar por la mañana', ['PREFIERE NADAR POR LA MANANA', 'Los martes no puede entrenar por la tarde']);
  assert.equal(second.notes, 'Lesión de rodilla en 2025.\n- Prefiere nadar por la mañana\n- Los martes no puede entrenar por la tarde');
  assert.deepEqual(second.added, ['Los martes no puede entrenar por la tarde']);
  assert.deepEqual(mergeCoachNotes('- Prefiere nadar por la mañana', ['prefiere nadar por la mañana']), {
    notes: null,
    added: [],
    known: ['prefiere nadar por la mañana'],
    skipped: [],
  });
});

test('coach notes never lose existing lines: facts that would exceed 4000 chars are skipped', () => {
  const userNotes = [`Notas mías: ${'a'.repeat(300)}`, ...Array.from({ length: 36 }, (_, i) => `- Hecho antiguo ${i} ${'b'.repeat(80)}`)].join('\n');
  assert.ok(userNotes.length > MAX_COACH_NOTES_CHARS - 200 && userNotes.length < MAX_COACH_NOTES_CHARS);
  const merged = mergeCoachNotes(userNotes, ['Corto', `Prefiere entrenar temprano ${'c'.repeat(100)}`]);
  assert.equal(MAX_COACH_NOTES_CHARS, 4000, 'same as the DB check');
  assert.ok(merged.notes !== null && merged.notes.startsWith(userNotes), 'every existing line is kept verbatim');
  assert.ok(merged.notes.length <= MAX_COACH_NOTES_CHARS);
  assert.deepEqual(merged.added, ['Corto']);
  assert.equal(merged.skipped.length, 1);
  const full = mergeCoachNotes('x'.repeat(MAX_COACH_NOTES_CHARS - 5), ['Prefiere nadar']);
  assert.deepEqual(full, { notes: null, added: [], known: [], skipped: ['Prefiere nadar'] });
});

test('life event: end defaults to start, end ≥ start, sane dates, strict kinds', () => {
  const ok = toLifeEventInsert(KNEE, TODAY);
  assert.deepEqual(ok, {
    ok: true,
    value: {
      kind: 'injury',
      title: 'Molestia en la rodilla',
      startDate: TODAY,
      endDate: TODAY,
      startTime: null,
      durationMin: null,
      severity: 2,
      bodyArea: 'knee',
      notes: 'Duele al bajar escaleras',
    },
  });
  assert.equal(toLifeEventInsert({ ...KNEE, end_date: '2026-10-20' }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, start_date: '2026-02-30' }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, start_date: '2025-01-01', end_date: '2025-01-02' }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, end_date: '2027-12-31' }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, end_date: '2027-02-21' }, TODAY).ok, true, '120 days (DB limit)');
  assert.equal(toLifeEventInsert({ ...KNEE, end_date: '2027-02-22' }, TODAY).ok, false, '121 days');
  assert.equal(toLifeEventInsert({ ...KNEE, kind: 'hangover' }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, severity: 4 }, TODAY).ok, false);
  assert.equal(toLifeEventInsert({ ...KNEE, body_area: 'elbow' }, TODAY).ok, false);
  const trip = toLifeEventInsert({ kind: 'travel', title: 'Viaje a Bilbao', start_date: '2026-10-28', end_date: '2026-10-30', severity: 1, body_area: null, notes: null }, TODAY);
  assert.ok(trip.ok && trip.value.endDate === '2026-10-30' && trip.value.notes === null);
});

test('life event duplicates: same kind, overlapping dates and same body area or title', () => {
  const parsed = toLifeEventInsert(KNEE, TODAY);
  assert.ok(parsed.ok);
  const existing = [{ kind: 'injury', title: 'Rodilla', startDate: '2026-10-22', endDate: '2026-10-26', bodyArea: 'knee' }];
  assert.equal(isDuplicateLifeEvent(parsed.value, existing), true);
  assert.equal(isDuplicateLifeEvent(parsed.value, [{ ...existing[0], bodyArea: 'ankle' }]), false);
  assert.equal(isDuplicateLifeEvent(parsed.value, [{ ...existing[0], endDate: '2026-10-23' }]), false);
  assert.equal(isDuplicateLifeEvent(parsed.value, [{ ...existing[0], bodyArea: null, title: 'molestia en la RODILLA' }]), true);
});

test('coach output: memory and life_event are required in the schema but default when missing', () => {
  const schema = COACH_OUTPUT_JSON_SCHEMA as { properties: { life_event: { anyOf: { required?: string[] }[] } } };
  assert.deepEqual(schema.properties.life_event.anyOf[0].required, ['kind', 'title', 'start_date', 'end_date', 'severity', 'body_area', 'notes']);
  const old = parseCoachOutput(JSON.stringify({ reply: 'Ok', summary: '', changes: [] }));
  assert.deepEqual(old && { memory: old.memory, life_event: old.life_event }, { memory: [], life_event: null });
  const broken = parseCoachOutput(JSON.stringify({ reply: 'Ok', summary: '', changes: [], memory: [], life_event: { kind: 'nope' } }));
  assert.ok(broken, 'an invalid life_event never discards the reply');
  assert.deepEqual(parseCoachOutput(JSON.stringify({ reply: 'Ok', summary: '', changes: [], memory: [3, 'Nada los lunes'] }))?.memory, ['Nada los lunes']);
  assert.ok(COACH_SYSTEM_PROMPT.includes('consulta a un profesional'));
  assert.ok(COACH_SYSTEM_PROMPT.includes('dictado por voz'));
});

test('coach output from weaker models degrades to a reply without the broken parts', () => {
  const partial = parseCoachOutput(
    JSON.stringify({
      reply: '  Te muevo la tirada al domingo.  ',
      changes: [
        { op: 'move', workoutId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date: '2026-10-25', reason: 'Lluvia', extra: 'ignored' },
        { op: 'teleport' },
        'not a change',
      ],
    }),
  );
  assert.ok(partial);
  assert.equal(partial.reply, 'Te muevo la tirada al domingo.');
  assert.equal(partial.summary, '');
  assert.equal(partial.changes.length, 1, 'missing nullable fields default to null, extra keys ignored');
  assert.equal(partial.changes[0].startTime, null);
  assert.equal(partial.malformedChanges, 2);
  assert.deepEqual(parseCoachOutput(JSON.stringify({ reply: 'Ok', changes: 'none' }))?.malformedChanges, 1);
  assert.equal(parseCoachOutput(JSON.stringify({ reply: '   ', changes: [] })), null, 'a reply is mandatory');
  assert.equal(parseCoachOutput('[]'), null);
});

test('coach request: channel voice/text accepted; voice messages are flagged as transcripts', async () => {
  const voice = parseCoachRequest({ mode: 'chat', weekStart: '2026-10-26', message: 'me duele la rodilla', channel: 'voice' });
  assert.ok(voice.ok && voice.value.channel === 'voice');
  assert.equal(parseCoachRequest({ mode: 'chat', weekStart: '2026-10-26', channel: 'telepathy' }).ok, false);
  const plain = parseCoachRequest({ mode: 'chat', weekStart: '2026-10-26', message: 'hola' });
  assert.ok(plain.ok && plain.value.channel === undefined);
  const context = await buildPlanningContext(fakeStore(stateWithWeek()), { userId: USER, now: fixedNow(), detail: 'concise' });
  assert.ok(voice.ok);
  const voiceMessages = buildCoachMessages(voice.value, context, {});
  assert.match(messageText(voiceMessages[voiceMessages.length - 1]), /dictado por voz.*: me duele la rodilla$/);
  assert.ok(plain.ok);
  const textMessages = buildCoachMessages(plain.value, context, {});
  assert.equal(messageText(textMessages[textMessages.length - 1]), 'Mensaje del atleta: hola');
});

function output(overrides: Record<string, unknown>): string {
  return JSON.stringify({ reply: 'Vale, lo apunto. Consulta a un profesional si no mejora.', summary: '', changes: [], memory: [], life_event: null, ...overrides });
}

function stateWithNotes(notes: string | null): FakeState {
  const state = stateWithWeek();
  state.profiles = [profile({ coachNotes: notes })];
  return state;
}

test('runCoachJob saves memory to coach_notes, logs the imprevisto and stores extras on the job', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(
    {
      reader: fakeStore(stateWithNotes('Notas: vive en Valencia')),
      store: rec.store,
      claude: claudeReturning({ text: output({ memory: ['Prefiere nadar por la mañana'], life_event: KNEE }) }, seen),
      now: fixedNow,
      logger: silentLogger,
    },
    job({ mode: 'chat', channel: 'voice', message: 'me duele la rodilla y prefiero nadar por la mañana' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.deepEqual(rec.jobs[0].extras, { memory: ['Prefiere nadar por la mañana'], lifeEventId: 'event-1' });
  assert.deepEqual(rec.coachNotes, ['Notas: vive en Valencia\n- Prefiere nadar por la mañana']);
  assert.equal(rec.lifeEvents[0].bodyArea, 'knee');
  assert.equal(rec.lifeEvents[0].endDate, TODAY);
  assert.match(messageText(seen[0].messages[seen[0].messages.length - 1]), /dictado por voz/);
});

test('runCoachJob: known facts are not rewritten, duplicates and invalid events are skipped, job still done', async () => {
  const state = stateWithNotes('- Prefiere nadar por la mañana');
  state.events.push({ id: 'e1', userId: USER, kind: 'injury', title: 'Rodilla', startDate: '2026-10-23', endDate: '2026-10-27', startTime: null, durationMin: null, severity: 2, bodyArea: 'knee', notes: null });
  const rec = runningRecorder();
  await runCoachJob(
    { reader: fakeStore(state), store: rec.store, claude: claudeReturning({ text: output({ memory: ['prefiere nadar por la mañana'], life_event: KNEE }) }), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.deepEqual(rec.jobs[0].extras, { memory: ['prefiere nadar por la mañana'], lifeEventId: null });
  assert.deepEqual(rec.coachNotes, [], 'nothing new to write');
  assert.equal(rec.lifeEvents.length, 0, 'the knee is already logged');

  const invalid = runningRecorder();
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: invalid.store, claude: claudeReturning({ text: output({ life_event: { ...KNEE, end_date: '2020-01-01' } }) }), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat' }),
  );
  assert.equal(invalid.jobs[0].status, 'done');
  assert.deepEqual(invalid.jobs[0].extras, { memory: [], lifeEventId: null });
});

test('runCoachJob: a failing memory or life-event write never fails the job', async () => {
  const rec = runningRecorder();
  rec.store = {
    ...rec.store,
    updateCoachNotes: async () => Promise.reject(new Error('db down')),
    insertLifeEvent: async () => Promise.reject(new Error('db down')),
  };
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: output({ memory: ['Nada los lunes'], life_event: KNEE }) }), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.deepEqual(rec.jobs[0].extras, { memory: [], lifeEventId: null });
});

test('memory and imprevistos are written only from a chat message of the athlete (never plan_week or replans)', async () => {
  assert.equal(mayWriteExtras({ mode: 'chat', message: 'me duele la rodilla' }), true);
  assert.equal(mayWriteExtras({ mode: 'chat', message: '   ' }), false);
  assert.equal(mayWriteExtras({ mode: 'chat' }), false);
  assert.equal(mayWriteExtras({ mode: 'plan_week', message: 'prefiero nadar por la mañana' }), false);
  assert.equal(mayWriteExtras({ mode: 'replan', message: 'me duele la rodilla' }), false);
  for (const request of [{ mode: 'plan_week' as const }, { mode: 'replan' as const }, { mode: 'chat' as const, message: '' }]) {
    const rec = runningRecorder();
    await runCoachJob(
      { reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: output({ memory: ['Prefiere nadar'], life_event: KNEE }) }), now: fixedNow, logger: silentLogger },
      job(request),
    );
    assert.equal(rec.jobs[0].status, 'done', request.mode);
    assert.deepEqual(rec.jobs[0].extras, { memory: [], lifeEventId: null });
    assert.deepEqual(rec.coachNotes, []);
    assert.deepEqual(rec.lifeEvents, []);
  }
});
