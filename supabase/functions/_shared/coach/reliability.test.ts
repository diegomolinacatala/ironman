import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { fakeStore, fixedNow } from '../testing/fakes.ts';
import { coachJob as job, PLANNED, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { defaultCoaching, withDefaultCoaching, zoneKey } from './defaults.ts';
import { claimsChanges, mentionsNextWeek, wantsPlanChange } from './intent.ts';
import { composeReply, FIRST_CALL_MAX_MS, friendlyIssue, runCoachJob } from './job.ts';
import { parseCoachOutput, toPlanChanges } from './output.ts';
import { messageText } from './ports.ts';
import type { ClaudePort, ClaudeRequest, ClaudeResponse } from './ports.ts';
import { resolveWorkoutId, shortenUuids, shortIdsFor } from './short-ids.ts';

/** Port that answers each call with the next text (the last one repeats). */
function sequence(texts: string[], seen: ClaudeRequest[] = []): ClaudePort {
  return {
    generate: async (req): Promise<ClaudeResponse> => {
      seen.push(req);
      const text = texts[Math.min(seen.length - 1, texts.length - 1)];
      return { text, stopReason: 'end_turn', model: 'm', inputTokens: 10, outputTokens: 5 };
    },
  };
}

/** A change in the short model shape. */
function change(overrides: Record<string, unknown>): Record<string, unknown> {
  return { op: 'move', workoutId: null, reason: 'Motivo', date: null, startTime: null, sport: null, title: null, durationMin: null, intensity: null, prescription: null, ...overrides };
}

const answer = (reply: string, changes: unknown[] = []): string => JSON.stringify({ reply, summary: 'Resumen', changes, memory: [], life_event: null, quedada: null, week_plans: null });

const deps = (claude: ClaudePort, rec = runningRecorder(), deadlineMs?: number) => ({
  reader: fakeStore(stateWithWeek()),
  store: rec.store,
  claude,
  now: fixedNow,
  logger: silentLogger,
  ...(deadlineMs ? { deadlineMs } : {}),
});

test('intent: plan-change requests are detected in Spanish, questions are not', () => {
  for (const m of [
    'Mueve el rodaje del martes al jueves',
    'quita el entreno de mañana',
    'Hoy no puedo entrenar',
    'cambia las series por un rodaje suave',
    'Tengo pádel el jueves por la tarde',
    'bórralo',
    'hazlo más corto',
    'Pásame la bici al sábado',
  ]) {
    assert.equal(wantsPlanChange(m), true, m);
  }
  for (const m of ['¿Qué toca hoy?', '¿Cuánto bebo en la tirada larga?', 'Hola coach', '']) assert.equal(wantsPlanChange(m), false, m);
  assert.equal(mentionsNextWeek('planifica la semana que viene'), true);
  assert.equal(claimsChanges('Te he movido las series al jueves.'), true);
  assert.equal(claimsChanges('Te propongo mover las series al jueves.'), false);
});

test('the model sees short ids (w1…) instead of workout UUIDs, also in the history', async () => {
  const seen: ClaudeRequest[] = [];
  await runCoachJob(
    deps(sequence([answer('Vale.')], seen)),
    job({ mode: 'chat', message: '¿Qué toca?', history: [{ role: 'assistant', content: `Propuesta: mover ${PLANNED} al 2026-10-29 (pendiente)` }] }),
  );
  const sent = seen[0].messages.map(messageText).join('\n');
  assert.ok(!sent.includes(PLANNED), 'no UUID of a workout reaches the model');
  assert.match(sent, /"id":"w1"/);
  assert.match(sent, /mover w1 al 2026-10-29/);
  assert.ok(!sent.includes('"notes"') && !sent.includes('"sportLabel"'), 'trimmed context');
  assert.equal(seen[0].effort, 'low');
  assert.ok((seen[0].timeoutMs ?? 0) <= FIRST_CALL_MAX_MS && (seen[0].timeoutMs ?? 0) > 0, 'each call has its own timeout');
});

test('a chat change request thinks harder, asks for concrete changes and maps w1 back to its UUID', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  const out = answer('Te propongo pasar las series al jueves.', [change({ workoutId: 'w1', date: '2026-10-29' })]);
  await runCoachJob(deps(sequence([out], seen), rec), job({ mode: 'chat', message: 'Mueve las series del martes al jueves' }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].effort, 'medium');
  assert.match(messageText(seen[0].messages[0]), /DEBES devolver en changes/);
  assert.equal(rec.jobs[0].status, 'done');
  assert.deepEqual(rec.proposals[0].changes, [{ op: 'move', workoutId: PLANNED, toDate: '2026-10-29', reason: 'Motivo' }]);
  assert.equal(rec.proposals[0].kind, 'chat');
});

test('a requested change that the model forgot triggers ONE repair with the id legend', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  const first = answer('Te he movido las series.');
  const second = answer('Te propongo pasar las series al jueves.', [change({ workoutId: 'W 1', date: '2026-10-29' })]);
  await runCoachJob(deps(sequence([first, second], seen), rec), job({ mode: 'chat', message: 'Mueve las series al jueves' }));
  assert.equal(seen.length, 2);
  const repair = seen[1].messages;
  assert.equal(repair[repair.length - 2].role, 'assistant');
  assert.match(messageText(repair[repair.length - 1]), /no has devuelto ninguno[\s\S]*w1 martes 2026-10-27 run «Series»/);
  assert.equal(rec.proposals.length, 1);
  assert.equal(rec.usage.length, 2, 'both calls are recorded');
});

test('every change dropped → repair; still dropped → honest reply and no proposal', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  const bad = answer('Te he movido las series al jueves.', [change({ workoutId: 'w9', date: '2026-10-29' })]);
  await runCoachJob(deps(sequence([bad], seen), rec), job({ mode: 'chat', message: 'Mueve las series al jueves' }));
  assert.equal(seen.length, 2, 'one repair only');
  assert.match(messageText(seen[1].messages[seen[1].messages.length - 1]), /Ninguno de tus cambios era válido/);
  assert.equal(rec.proposals.length, 0);
  assert.equal(rec.jobs[0].status, 'done');
  assert.match(rec.jobs[0].reply ?? '', /^No he podido preparar el cambio en tu plan: no he encontrado esa sesión/);
  assert.ok(!/he movido/.test(rec.jobs[0].reply ?? ''));
});

test('invalid JSON first, valid answer on the repair', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(deps(sequence(['no es json', answer('Hidrátate bien.')], seen), rec), job({ mode: 'chat', message: '¿Qué bebo?' }));
  assert.equal(seen.length, 2);
  assert.equal(seen[1].effort, 'low');
  assert.equal(rec.jobs[0].status, 'done');
  assert.equal(rec.jobs[0].reply, 'Hidrátate bien.');
});

test('no repair when the job has no time left for it', async () => {
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(deps(sequence(['no es json', answer('Ok')], seen), rec, 20_000), job({ mode: 'chat', message: '¿Qué bebo?' }));
  assert.equal(seen.length, 1);
  assert.equal(rec.jobs[0].status, 'error');
  assert.match(rec.jobs[0].error ?? '', /formato esperado/);
});

test('loose id matching: a title or a broken UUID still finds the only matching planned workout', () => {
  const state = stateWithWeek();
  const workouts = state.workouts;
  const ids = shortIdsFor({ week: { totals: {} as never, workouts: [{ id: PLANNED } as never] } });
  const hints = { op: 'move' as const, title: null, sport: null, date: null };
  assert.deepEqual(resolveWorkoutId('w1', hints, ids, workouts, '2026-10-24'), { id: PLANNED, loose: false });
  assert.deepEqual(resolveWorkoutId(PLANNED, hints, ids, workouts, '2026-10-24'), { id: PLANNED, loose: false });
  assert.deepEqual(resolveWorkoutId('Series', hints, ids, workouts, '2026-10-24'), { id: PLANNED, loose: true });
  assert.deepEqual(resolveWorkoutId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', { ...hints, sport: 'run' }, ids, workouts, '2026-10-24'), { id: PLANNED, loose: true });
  assert.deepEqual(resolveWorkoutId('w7', { ...hints, sport: 'swim' }, ids, workouts, '2026-10-24'), { id: null, loose: false });
  assert.equal(shortenUuids(`mover ${PLANNED}`, ids), 'mover w1');
});

test('short model changes parse with the nested prescription; legacy flat keys still work', () => {
  const steps = [{ kind: 'work', durationMin: 40, distanceM: null, repeat: null, intensity: 'endurance', cue: null, leg: null }];
  const output = parseCoachOutput(
    JSON.stringify({
      reply: 'Ok',
      changes: [
        change({ op: 'add', date: '2026-10-28', sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'endurance', prescription: { steps, objective: 'Base', keys: ['Z2'], success: 'Hablar', planB: null } }),
        { op: 'add', workoutId: null, reason: 'x', date: '2026-10-29', sport: 'swim', title: 'Técnica', durationMin: 45, intensity: 'recovery', objective: 'Técnica', success: 'Fluido' },
      ],
    }),
  );
  assert.ok(output);
  const { changes } = toPlanChanges(output.changes);
  assert.equal(changes.length, 2);
  assert.ok(changes[0].op === 'add' && changes[0].workout.coaching?.objective === 'Base' && changes[0].workout.steps?.length === 1);
  assert.ok(changes[1].op === 'add' && changes[1].workout.coaching?.success === 'Fluido');
});

test('server defaults: a new session without prescription gets one with the athlete zone numbers', () => {
  const zones = { run: { Z2: '145–151 ppm · 5:08–5:48 /km · RPE 3–4' }, bike: {}, swim: {} };
  assert.equal(zoneKey(zones, 'run', 'endurance'), 'Z2: 145–151 ppm · 5:08–5:48 /km · RPE 3–4');
  assert.equal(zoneKey(zones, 'strength', 'endurance'), null);
  assert.equal(defaultCoaching({ sport: 'rest', intensity: 'recovery' }, zones), null);
  const [filled, kept] = withDefaultCoaching(
    [
      { op: 'add', workout: { date: '2026-10-28', sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'endurance' }, reason: 'x' },
      { op: 'add', workout: { date: '2026-10-28', sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'threshold', coaching: { objective: 'Mío', keys: [], success: 'Sí', planB: null } }, reason: 'x' },
    ],
    zones,
  );
  assert.ok(filled.op === 'add' && filled.workout.coaching?.keys[0]?.startsWith('Z2: 145'));
  assert.ok(filled.op === 'add' && filled.workout.coaching?.planB === null, 'easy sessions need no plan B');
  assert.ok(kept.op === 'add' && kept.workout.coaching?.objective === 'Mío', 'the model prescription wins');
});

test('composeReply never claims changes that are not in the proposal', () => {
  const output = parseCoachOutput(answer('Te he quitado el rodaje.'));
  assert.ok(output);
  const none = { changes: [], dropped: 0, issues: [], loose: 0 };
  assert.match(composeReply(output, none, false), /^No he podido preparar ese cambio/);
  assert.equal(composeReply({ ...output, reply: 'Bebe agua.' }, none, false), 'Bebe agua.');
  assert.match(composeReply({ ...output, reply: 'Te propongo esto.' }, { ...none, dropped: 1 }, true), /He descartado 1 cambio[\s\S]*Revisa la propuesta/);
  assert.equal(friendlyIssue(['la fecha 2026-10-20 ya ha pasado (hoy es 2026-10-24)']), 'esa fecha ya ha pasado');
  assert.equal(friendlyIssue(['el entreno w2 («Series») ya está completado']), 'esa sesión ya está hecha o saltada');
});
