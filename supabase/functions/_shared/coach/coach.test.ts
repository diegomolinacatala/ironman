import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { fakeStore, fixedNow } from '../testing/fakes.ts';
import { claudeReturning, coachJob as job, flat, PLANNED, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { runCoachJob } from './job.ts';
import { buildCoachMessages } from './messages.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput, toPlanChanges } from './output.ts';
import { CoachAiError } from './ports.ts';
import type { ClaudeRequest, ClaudeResponse } from './ports.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';
import { parseCoachRequest } from './request.ts';

test('parseCoachRequest validates and normalizes the app request', () => {
  const ok = parseCoachRequest({ mode: 'plan_week', weekStart: '2026-10-28', message: '  ', history: [{ role: 'user', content: 'hola', extra: 1 }], unknown: true });
  assert.ok(ok.ok);
  assert.equal(ok.value.weekStart, '2026-10-26');
  assert.equal(ok.value.message, undefined);
  assert.equal(ok.value.history?.length, 1);
  assert.equal(parseCoachRequest({ mode: 'yolo', weekStart: '2026-10-26' }).ok, false);
  assert.equal(parseCoachRequest({ mode: 'chat', weekStart: '2026-02-30' }).ok, false);
  assert.equal(parseCoachRequest({ mode: 'chat', weekStart: '2026-10-26', friendIds: ['nope'] }).ok, false);
});

test('structured output schema has every property required and no numeric bounds', () => {
  const schema = COACH_OUTPUT_JSON_SCHEMA as { required: string[]; properties: { changes: { items: { required: string[]; additionalProperties: boolean } } } };
  assert.deepEqual(schema.required, ['reply', 'summary', 'changes']);
  assert.equal(schema.properties.changes.items.required.length, 12);
  assert.equal(schema.properties.changes.items.additionalProperties, false);
  assert.ok(!JSON.stringify(schema).includes('minimum'));
  assert.ok(!JSON.stringify(schema).includes('minLength'));
});

test('flat changes convert to strict PlanChange and invalid ones are rejected', () => {
  const { changes, rejected } = toPlanChanges([
    flat({ op: 'add', date: '2026-10-28', sport: 'swim', title: 'Técnica', durationMin: 45, intensity: 'recovery' }),
    flat({ op: 'move', workoutId: PLANNED, date: '2026-10-29' }),
    flat({ op: 'update', workoutId: PLANNED, durationMin: 40 }),
    flat({ op: 'add', date: '2026-10-28', sport: 'run', title: 'Sin duración', intensity: 'endurance' }),
    flat({ op: 'delete', workoutId: 'not-a-uuid' }),
  ] as never);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes[1], { op: 'move', workoutId: PLANNED, toDate: '2026-10-29', reason: 'Motivo' });
  assert.deepEqual(changes[2], { op: 'update', workoutId: PLANNED, patch: { durationMin: 40 }, reason: 'Motivo' });
  assert.deepEqual(rejected.map((r) => r.index), [3, 4]);
  assert.equal(parseCoachOutput('not json'), null);
  assert.equal(parseCoachOutput(JSON.stringify({ reply: 'x' })), null);
});

test('messages put the context first and always end with a user turn', () => {
  const msgs = buildCoachMessages(
    { mode: 'chat', weekStart: '2026-10-26', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
    { weekStart: '2026-10-26' } as never,
    {},
  );
  assert.equal(msgs[0].role, 'user');
  assert.match(msgs[0].content, /Contexto del atleta/);
  assert.equal(msgs[msgs.length - 1].role, 'user');
  assert.equal(msgs.length, 4);
  assert.ok(!COACH_SYSTEM_PROMPT.includes('2026'), 'system prompt stays static (cacheable)');
});

test('runCoachJob stores validated changes as an ai_coach proposal and finishes the job', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  const output = {
    reply: 'Muevo las series al jueves.',
    summary: 'Series al jueves',
    changes: [
      flat({ op: 'move', workoutId: PLANNED, date: '2026-10-29' }),
      flat({ op: 'delete', workoutId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      flat({ op: 'add', date: '2026-10-20', sport: 'run', title: 'Pasado', durationMin: 30, intensity: 'endurance' }),
    ],
  };
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: JSON.stringify(output) }, seen), now: fixedNow, logger: silentLogger },
    job(),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.equal(rec.jobs[0].proposalId, 'proposal-1');
  assert.match(rec.jobs[0].reply ?? '', /He descartado 2 cambios/);
  assert.equal(rec.proposals[0].source, 'ai_coach');
  assert.equal(rec.proposals[0].kind, 'replan');
  assert.equal(rec.proposals[0].model, 'claude-opus-5-5');
  assert.equal(rec.proposals[0].changes.length, 1);
  assert.deepEqual(rec.usage, [{ model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 200 }]);
  assert.equal(seen[0].effort, 'medium');
  assert.equal(seen[0].system, COACH_SYSTEM_PROMPT);
  assert.ok(seen[0].signal instanceof AbortSignal, 'the Claude call gets the job deadline signal');
  assert.equal(seen[0].messages[seen[0].messages.length - 1].role, 'user');
});

test('runCoachJob without changes finishes without a proposal (chat uses low effort)', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: JSON.stringify({ reply: 'Hidrátate bien.', summary: '', changes: [] }) }, seen), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.equal(rec.jobs[0].proposalId, null);
  assert.equal(seen[0].effort, 'low');
});

test('runCoachJob handles refusal, max_tokens, bad output and API errors with Spanish messages', async () => {
  const cases: [Partial<ClaudeResponse> | Error, RegExp][] = [
    [{ stopReason: 'refusal' }, /no ha podido responder/],
    [{ stopReason: 'max_tokens', text: '{"reply":' }, /demasiado larga/],
    [{ text: '{"nope":1}' }, /formato esperado/],
    [new CoachAiError('rate_limited', 'El coach con IA está saturado ahora mismo.'), /saturado/],
    [new Error('boom'), /no está disponible/],
  ];
  for (const [response, message] of cases) {
    const rec = runningRecorder();
    await runCoachJob({ reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning(response), now: fixedNow, logger: silentLogger }, job());
    assert.equal(rec.jobs[0].status, 'error');
    assert.match(rec.jobs[0].error ?? '', message);
  }
});
