import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { claudeReturning, coachJob as job, flat, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import { runCoachJob } from './job.ts';
import { COACH_OUTPUT_JSON_SCHEMA, parseCoachOutput, toPlanChanges } from './output.ts';
import { clipText, normalizeSteps, toCoaching, toWorkoutSteps } from './prescription.ts';
import { COACH_SYSTEM_PROMPT } from './prompt.ts';
import { toCoachWeekPlans } from './week-plans.ts';

const STEPS = [
  { kind: 'warmup', durationMin: 15, distanceM: null, repeat: null, intensity: 'recovery', cue: 'Suave y suelto' },
  { kind: 'work', durationMin: 8, distanceM: null, repeat: 3, intensity: 'threshold', cue: 'Solo palabras sueltas' },
  { kind: 'recovery', durationMin: 3, distanceM: null, repeat: 3, intensity: 'recovery', cue: null },
  { kind: 'cooldown', durationMin: 7, distanceM: null, repeat: null, intensity: 'recovery', cue: null },
];

const PRESCRIPTION = {
  objective: 'Subir tu umbral con tres bloques sostenidos',
  keys: ['Series a 162–168 ppm, RPE 7–8', 'La primera no más rápida que la última'],
  success: 'Las 3 series entre 162 y 168 ppm',
  planB: 'Si no es tu día: 2 series',
};

const ADD = flat({ op: 'add', date: '2026-10-28', sport: 'run', title: 'Umbral 3×8', durationMin: 55, intensity: 'threshold', isKey: true, steps: STEPS, ...PRESCRIPTION });

test('an add with steps and prescription becomes a strict PlanChange with steps and coaching', () => {
  const { changes, rejected } = toPlanChanges([ADD] as never);
  assert.deepEqual(rejected, []);
  const add = changes[0];
  assert.ok(add.op === 'add');
  assert.deepEqual(add.workout.steps, [
    { kind: 'warmup', durationMin: 15, intensity: 'recovery', cue: 'Suave y suelto' },
    { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Solo palabras sueltas' },
    { kind: 'recovery', durationMin: 3, repeat: 3, intensity: 'recovery' },
    { kind: 'cooldown', durationMin: 7, intensity: 'recovery' },
  ]);
  assert.deepEqual(add.workout.coaching, PRESCRIPTION);
  const update = toPlanChanges([flat({ op: 'update', workoutId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...PRESCRIPTION, planB: null })] as never);
  assert.deepEqual(update.changes[0], {
    op: 'update',
    workoutId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    patch: { coaching: { ...PRESCRIPTION, planB: null } },
    reason: 'Motivo',
  });
});

test('lenient parsing: a bad step or text is dropped or clipped, never the whole change', () => {
  const output = parseCoachOutput(
    JSON.stringify({
      reply: 'Te pongo las series el miércoles.',
      changes: [
        {
          ...ADD,
          startTime: '7:30',
          reason: '',
          steps: [{ kind: 'sprint', durationMin: 5 }, { kind: 'work', durationMin: 'diez' }, ...STEPS, 'paso'],
          objective: 'x'.repeat(260),
          keys: ['Clave buena', 42, '', 'y'.repeat(200), 'Tercera', 'Cuarta', 'Quinta'],
          success: null,
        },
      ],
    }),
  );
  assert.ok(output);
  assert.equal(output.malformedChanges, 0);
  const c = output.changes[0];
  assert.equal(c.startTime, '07:30');
  assert.equal(c.reason, 'Ajuste del entrenador');
  assert.equal(c.steps?.length, 4, 'unknown kinds and steps without an amount are dropped');
  assert.equal(c.objective?.length, 200);
  assert.ok(c.objective?.endsWith('…'));
  assert.deepEqual(c.keys?.map((k) => k.length), [11, 160, 7, 6]);
  const { changes } = toPlanChanges(output.changes);
  assert.equal(changes.length, 1, 'the change survives');
  assert.ok(changes[0].op === 'add' && changes[0].workout.coaching === undefined, 'no success → no prescription, but the session stays');
  assert.equal(changes[0].op === 'add' && changes[0].workout.steps?.length, 4);
});

test('prescription helpers: clipping, steps by distance and the coaching minimum', () => {
  assert.equal(clipText('  hola   mundo ', 20), 'hola mundo');
  assert.equal(clipText('', 20), null);
  assert.equal(clipText(3, 20), null);
  assert.deepEqual(normalizeSteps([{ kind: 'work', distanceM: 100.4, repeat: 10, intensity: 'tempo', cue: '' }]), [
    { kind: 'work', durationMin: null, distanceM: 100, repeat: 10, intensity: 'tempo', cue: null, leg: null },
  ]);
  assert.equal(normalizeSteps('nope'), null);
  assert.equal(normalizeSteps([{ kind: 'work' }]), null);
  assert.equal(toCoaching({ objective: 'Algo', success: null }), null);
  assert.deepEqual(toCoaching({ objective: 'Algo', success: 'Bien', keys: null, planB: null }), { objective: 'Algo', keys: [], success: 'Bien', planB: null });
});

test('week_plans: Mondays from this week to +26, known kinds, editable weeks; texts clipped', () => {
  const target = { id: 'r1', name: 'Medio', date: '2027-03-14', distance: 'half' as const, priority: 'A' as const, location: null, goal: null, notes: null };
  const tenK = { id: 'r2', name: '10K', date: '2026-11-08', distance: 'run_10k' as const, priority: 'B' as const, location: null, goal: null, notes: null };
  const { weekPlans, dropped } = toCoachWeekPlans(
    [
      { week_start: '2026-11-16', kind: 'push', target_minutes: 540.4, note: `  Más ${'volumen '.repeat(60)}` },
      { week_start: '2026-10-26', kind: 'recovery', target_minutes: null, note: 'Semana de exámenes' },
      { week_start: '2026-10-27', kind: 'load', target_minutes: null, note: null },
      { week_start: '2026-10-12', kind: 'load', target_minutes: null, note: null },
      { week_start: '2027-04-26', kind: 'load', target_minutes: null, note: null },
      { week_start: '2026-11-23', kind: 'taper', target_minutes: null, note: null },
      { week_start: '2026-11-02', kind: 'rest', target_minutes: null, note: null },
      { week_start: '2026-10-26', kind: 'load', target_minutes: null, note: null },
      'semana',
    ],
    { today: '2026-10-24', races: [target, tenK] },
  );
  assert.deepEqual(
    weekPlans.map((w) => [w.weekStart, w.kind, w.targetMinutes, w.source]),
    [
      ['2026-10-26', 'recovery', null, 'ai_coach'],
      ['2026-11-16', 'push', 540, 'ai_coach'],
    ],
  );
  assert.ok((weekPlans[1].note?.length ?? 0) <= 300);
  assert.equal(dropped.length, 7);
  assert.ok(dropped.some((d) => /no es lunes/.test(d)));
  assert.ok(dropped.some((d) => /ya ha pasado/.test(d)));
  assert.ok(dropped.some((d) => /más de 26 semanas/.test(d)));
  assert.ok(dropped.some((d) => /2026-11-02 tiene carrera/.test(d)), 'a week with a race cannot be adjusted');
  assert.ok(dropped.some((d) => /repetida/.test(d)));
  assert.deepEqual(toCoachWeekPlans(null, { today: '2026-10-24', races: [] }), { weekPlans: [], dropped: [] });
});

test('structured output publishes week_plans as a nullable array of complete weeks', () => {
  const schema = COACH_OUTPUT_JSON_SCHEMA as { properties: { week_plans: { anyOf: { type: string; items?: { required: string[] } }[] } } };
  const variants = schema.properties.week_plans.anyOf;
  assert.deepEqual(variants.map((v) => v.type), ['array', 'null']);
  assert.deepEqual(variants[0].items?.required, ['week_start', 'kind', 'target_minutes', 'note']);
  assert.equal(parseCoachOutput(JSON.stringify({ reply: 'Hola' }))?.week_plans, null);
  assert.match(COACH_SYSTEM_PROMPT, /week_plans: null, o las semanas/);
  assert.match(COACH_SYSTEM_PROMPT, /athlete\.zones/);
  assert.match(COACH_SYSTEM_PROMPT, /Garmin o COROS/);
  assert.ok(!COACH_SYSTEM_PROMPT.includes('2026'), 'system prompt stays static (cacheable)');
});

function output(overrides: Record<string, unknown>): string {
  return JSON.stringify({ reply: 'Te propongo una descarga la semana que viene.', summary: '', changes: [], memory: [], life_event: null, quedada: null, ...overrides });
}

const WEEKS = [
  { week_start: '2026-10-26', kind: 'recovery', target_minutes: 300, note: 'Semana de exámenes' },
  { week_start: '2026-10-27', kind: 'push', target_minutes: null, note: null },
];

test('runCoachJob stores the suggested week plans in extras (chat only) and the session prescription in the proposal', async () => {
  const rec = runningRecorder();
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: output({ week_plans: WEEKS, changes: [ADD] }) }), now: fixedNow, logger: silentLogger },
    job({ mode: 'chat', message: 'planifica las próximas semanas por encima, tengo exámenes' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.deepEqual(rec.jobs[0].extras?.weekPlans, [{ weekStart: '2026-10-26', kind: 'recovery', targetMinutes: 300, note: 'Semana de exámenes', source: 'ai_coach' }]);
  const added = rec.proposals[0].changes[0];
  assert.ok(added.op === 'add');
  assert.equal(added.workout.coaching?.objective, PRESCRIPTION.objective);
  assert.equal(added.workout.steps?.length, 4);

  const replan = runningRecorder();
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: replan.store, claude: claudeReturning({ text: output({ week_plans: WEEKS }) }), now: fixedNow, logger: silentLogger },
    job({ mode: 'replan', message: 'tengo exámenes' }),
  );
  assert.deepEqual(replan.jobs[0].extras?.weekPlans, [], 'never outside a chat message');
  assert.equal(USER.length, 36);
});

test('coach steps keep the brick leg', () => {
  const steps = normalizeSteps([
    { kind: 'work', durationMin: 60, intensity: 'endurance', leg: 'bike' },
    { kind: 'work', durationMin: 15, intensity: 'endurance', leg: 'run' },
    { kind: 'cooldown', durationMin: 5, leg: 'swim' },
  ]);
  assert.deepEqual(toWorkoutSteps(steps)?.map((s) => s.leg), ['bike', 'run', undefined]);
});
