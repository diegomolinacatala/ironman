import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { applyPlanChanges } from '../../src/domain/changes.ts';
import type { PlanChange, Workout } from '../../src/domain/types.ts';
import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface ApplyJson {
  applied: number;
  failed: { index: number; error: string }[];
}

interface DbWorkout {
  id: string;
  user_id: string;
  date: string;
  start_time: string | null;
  sport: Workout['sport'];
  title: string;
  description: string | null;
  duration_min: number;
  distance_m: number | null;
  intensity: Workout['intensity'];
  tss: number | null;
  steps: Workout['steps'];
  status: Workout['status'];
  completed: Workout['completed'];
  source: Workout['source'];
  is_key: boolean;
  joint_session_id: string | null;
  external_id: string | null;
}

const SELECT_WORKOUTS = `
  select id, user_id, date::text as date, to_char(start_time, 'HH24:MI') as start_time, sport, title, description,
    duration_min, distance_m, intensity, tss::float8 as tss, steps, status, completed, source, is_key,
    joint_session_id, external_id
  from public.workouts where user_id = $1`;

function toDomain(row: DbWorkout): Workout {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    startTime: row.start_time,
    sport: row.sport,
    title: row.title,
    description: row.description,
    durationMin: row.duration_min,
    distanceM: row.distance_m,
    intensity: row.intensity,
    tss: row.tss,
    steps: row.steps,
    status: row.status,
    completed: row.completed,
    source: row.source,
    isKey: row.is_key,
    jointSessionId: row.joint_session_id,
    externalId: row.external_id,
    createdAt: '2026-10-25T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
  };
}

/** WorkoutCoaching as stored by apply_plan_changes (v4). */
interface Coaching {
  objective: string;
  keys: string[];
  success: string;
  planB: string | null;
}

/** As the coach / Claude may send it: untrimmed texts and an unknown key. */
const COACHING_INPUT = {
  objective: '  Subir tu umbral sin pasarte de vueltas  ',
  keys: [' Calienta 15′ suave antes de la primera serie ', 'Series a 162–168 ppm, 4:27–4:44 /km'],
  success: 'Las 3 series al mismo ritmo y RPE 7–8 en la última',
  planB: ' Si vas cansado: 45′ suaves en Z2 ',
  extra: 'se descarta',
};

const COACHING_STORED: Coaching = {
  objective: 'Subir tu umbral sin pasarte de vueltas',
  keys: ['Calienta 15′ suave antes de la primera serie', 'Series a 162–168 ppm, 4:27–4:44 /km'],
  success: 'Las 3 series al mismo ritmo y RPE 7–8 en la última',
  planB: 'Si vas cansado: 45′ suaves en Z2',
};

/** Run session with explicit targets and cues (stored verbatim in workouts.steps). */
const RUN_STEPS: Workout['steps'] = [
  { kind: 'warmup', durationMin: 15, intensity: 'endurance', cue: 'Respiración cómoda: puedes hablar en frases' },
  {
    kind: 'work',
    durationMin: 8,
    repeat: 3,
    intensity: 'threshold',
    target: { hr: { min: 162, max: 168 }, pace: { min: 267, max: 284 }, rpe: { min: 7, max: 8 } },
    cue: 'Ritmo constante, sin acelerar al final',
  },
  { kind: 'recovery', durationMin: 2, intensity: 'recovery', note: 'Trote muy suave' },
  { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
];

/** Brick: bike leg on power, run leg on pace. */
const BRICK_STEPS: Workout['steps'] = [
  { kind: 'work', durationMin: 60, intensity: 'tempo', leg: 'bike', target: { power: { min: 200, max: 220 }, rpe: { min: 6, max: 7 } } },
  { kind: 'work', durationMin: 20, intensity: 'race', leg: 'run', target: { pace: { min: 290, max: 300 } }, cue: 'Cadencia alta los primeros 5′' },
];

/** Comparable projection (ids of added workouts differ between TS and SQL). */
function fingerprint(w: Workout): string {
  return JSON.stringify([
    w.date, w.startTime, w.sport, w.title, w.description, w.durationMin, w.distanceM,
    w.intensity, w.tss, w.steps, w.status, w.source, w.isKey,
  ]);
}

describe('apply_plan_changes', () => {
  let t: TestDb;
  let me: string;
  let other: string;

  const insertWorkout = async (user: string, values: { date: string; title: string; status?: string; start?: string | null }) => {
    const [row] = await t.admin<{ id: string }>(
      `insert into public.workouts (user_id, date, start_time, sport, title, duration_min, intensity, status, tss)
       values ($1, $2, $3, 'run', $4, 45, 'endurance', $5, 40) returning id`,
      [user, values.date, values.start === undefined ? '07:30' : values.start, values.title, values.status ?? 'planned'],
    );
    assert.ok(row?.id);
    return row.id;
  };
  const apply = async (user: string, changes: unknown, proposalId: string | null = null): Promise<ApplyJson> => {
    const [row] = await t.asUser<{ r: ApplyJson }>(
      user,
      'select public.apply_plan_changes($1::jsonb, $2) as r',
      [JSON.stringify(changes), proposalId],
    );
    assert.ok(row);
    return row.r;
  };
  const workoutsOf = async (user: string): Promise<Workout[]> =>
    (await t.admin<DbWorkout>(SELECT_WORKOUTS, [user])).map(toDomain);

  before(async () => {
    t = await createTestDb();
    me = await t.createUser({ email: 'me@example.com' });
    other = await t.createUser({ email: 'other@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('same results as src/domain/changes.ts for a mixed batch', async () => {
    const planned = await insertWorkout(me, { date: '2026-11-02', title: 'Rodaje' });
    const planned2 = await insertWorkout(me, { date: '2026-11-03', title: 'Series' });
    const planned3 = await insertWorkout(me, { date: '2026-11-04', title: 'Cuestas' });
    const done = await insertWorkout(me, { date: '2026-10-30', title: 'Hecho', status: 'completed' });
    const foreign = await insertWorkout(other, { date: '2026-11-02', title: 'Ajeno' });

    const changes: PlanChange[] = [
      { op: 'add', workout: { date: '2026-11-05', startTime: '18:00', sport: 'swim', title: '  Técnica ', durationMin: 45.4, intensity: 'endurance', distanceM: 2000, isKey: true, source: 'claude', steps: [{ kind: 'work', durationMin: 10 }] }, reason: 'r' },
      { op: 'add', workout: { date: '2026-11-05', startTime: '25:00', sport: 'swim', title: 'Mal', durationMin: 30, intensity: 'endurance' }, reason: 'r' },
      { op: 'add', workout: { date: '2026-11-05', sport: 'bike', title: 'Larga', durationMin: 800, intensity: 'endurance' }, reason: 'r' },
      { op: 'add', workout: { date: '2026-11-05', sport: 'bike', title: '   ', durationMin: 60, intensity: 'endurance' }, reason: 'r' },
      { op: 'add', workout: { date: '5/11/2026', sport: 'bike', title: 'Fecha', durationMin: 60, intensity: 'endurance' }, reason: 'r' },
      { op: 'update', workoutId: planned, patch: { durationMin: 30, title: ' Rodaje corto ', intensity: 'recovery', source: 'ai_coach' }, reason: 'r' },
      { op: 'update', workoutId: done, patch: { title: 'Hecho (editado)', description: 'nota' }, reason: 'r' },
      { op: 'move', workoutId: done, toDate: '2026-11-06', reason: 'r' },
      { op: 'delete', workoutId: done, reason: 'r' },
      { op: 'move', workoutId: planned2, toDate: '2026-11-07', toStartTime: null, reason: 'r' },
      { op: 'move', workoutId: planned3, toDate: '2026-11-08', reason: 'r' },
      { op: 'delete', workoutId: randomUUID(), reason: 'r' },
      { op: 'delete', workoutId: foreign, reason: 'r' },
      { op: 'update', workoutId: planned3, patch: { startTime: '7:00' }, reason: 'r' },
      { op: 'update', workoutId: planned3, patch: { durationMin: -5 }, reason: 'r' },
      { op: 'move', workoutId: planned3, toDate: 'mañana', reason: 'r' },
      { op: 'move', workoutId: planned3, toDate: '2026-11-08', toStartTime: '6:30', reason: 'r' },
      { op: 'delete', workoutId: planned, reason: 'r' },
      { op: 'update', workoutId: planned, patch: { title: 'Ya no existe' }, reason: 'r' },
      { op: 'update', workoutId: planned2, patch: { isKey: true, tss: 55.5, distanceM: null, startTime: '19:15' }, reason: 'r' },
    ];

    const before = await workoutsOf(me);
    const expected = applyPlanChanges(before, changes, { userId: me, now: '2026-10-25T10:00:00Z', newId: () => randomUUID() });
    const actual = await apply(me, changes);

    assert.deepEqual(actual, { applied: expected.applied, failed: expected.failed });
    const after = await workoutsOf(me);
    assert.deepEqual(after.map(fingerprint).sort(), expected.workouts.map(fingerprint).sort());

    const [untouched] = await t.admin<{ title: string }>('select title from public.workouts where id = $1', [foreign]);
    assert.equal(untouched?.title, 'Ajeno', "other user's workout is never touched");
  });

  test('database-only validations are reported per change without aborting the batch', async () => {
    const id = await insertWorkout(me, { date: '2026-11-10', title: 'Base' });
    const result = await apply(me, [
      { op: 'add', workout: { date: '2026-02-30', sport: 'run', title: 'Fecha imposible', durationMin: 30, intensity: 'endurance' } },
      { op: 'add', workout: { date: '2026-11-11', sport: 'ski', title: 'Esquí', durationMin: 30, intensity: 'endurance' } },
      { op: 'add', workout: { date: '2026-11-11', sport: 'run', title: 'Z9', durationMin: 30, intensity: 'z9' } },
      { op: 'add', workout: { date: '2026-11-11', sport: 'run', title: 'Pasos', durationMin: 30, intensity: 'endurance', steps: 'no' } },
      { op: 'fly', workoutId: id },
      'no soy un objeto',
      { op: 'update', workoutId: 'not-a-uuid', patch: { title: 'X' } },
      { op: 'update', workoutId: id, patch: { sport: null } },
      { op: 'update', workoutId: id, patch: { title: 'x'.repeat(121) } },
      { op: 'update', workoutId: id, patch: { status: 'completed', completed: { rpe: 9 }, jointSessionId: randomUUID(), userId: other } },
      { op: 'add', workout: { date: '2026-11-12', sport: 'run', title: 'Válido', durationMin: 0, intensity: 'recovery' } },
    ]);
    assert.equal(result.applied, 2);
    assert.deepEqual(result.failed, [
      { index: 0, error: 'Fecha inválida' },
      { index: 1, error: 'Deporte no válido' },
      { index: 2, error: 'Intensidad no válida' },
      { index: 3, error: 'Pasos no válidos' },
      { index: 4, error: 'Cambio no válido' },
      { index: 5, error: 'Cambio no válido' },
      { index: 6, error: 'Entreno no encontrado' },
      { index: 7, error: 'Deporte no válido' },
      { index: 8, error: 'Título demasiado largo' },
    ]);
    const [row] = await t.admin<{ status: string; user_id: string; joint_session_id: string | null; completed: unknown }>(
      'select status, user_id, joint_session_id, completed from public.workouts where id = $1',
      [id],
    );
    assert.deepEqual(row, { status: 'planned', user_id: me, joint_session_id: null, completed: null }, 'patch ignores non-draft keys');
    const added = await t.admin<{ source: string; status: string; steps: unknown[] }>(
      `select source, status, steps from public.workouts where user_id = $1 and title = 'Válido'`,
      [me],
    );
    assert.deepEqual(added, [{ source: 'manual', status: 'planned', steps: [] }]);
  });

  test('input must be an array of at most 200 changes; callers must be signed in', async () => {
    await assert.rejects(apply(me, { op: 'add' }), pgError({ hint: 'validation' }));
    await assert.rejects(apply(me, Array.from({ length: 201 }, () => ({ op: 'delete', workoutId: randomUUID() }))), pgError({ hint: 'validation' }));
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query(`select public.apply_plan_changes('[]'::jsonb)`);
      }),
      pgError({ hint: 'not_authenticated' }),
    );
    assert.deepEqual(await apply(me, []), { applied: 0, failed: [] });
  });

  test('marks the proposal applied / partially applied (own proposals only)', async () => {
    const id = await insertWorkout(me, { date: '2026-11-20', title: 'Para mover' });
    const changes = [
      { op: 'move', workoutId: id, toDate: '2026-11-21', reason: 'r' },
      { op: 'add', workout: { date: '2026-11-22', sport: 'run', title: 'Nuevo', durationMin: 40, intensity: 'endurance' }, reason: 'r' },
    ];
    const proposal = async (user: string) => {
      const [row] = await t.admin<{ id: string }>(
        `insert into public.plan_proposals (user_id, kind, source, week_start, changes) values ($1, 'replan', 'rules', '2026-11-16', $2::jsonb) returning id`,
        [user, JSON.stringify(changes)],
      );
      assert.ok(row?.id);
      return row.id;
    };
    const statusOf = async (pid: string) =>
      (await t.admin<{ status: string }>('select status from public.plan_proposals where id = $1', [pid]))[0]?.status;

    const full = await proposal(me);
    await apply(me, changes, full);
    assert.equal(await statusOf(full), 'applied');

    const partial = await proposal(me);
    await apply(me, [changes[1]], partial);
    assert.equal(await statusOf(partial), 'partially_applied', 'subset applied');

    const failing = await proposal(me);
    await apply(me, [{ op: 'delete', workoutId: randomUUID() }, changes[1]], failing);
    assert.equal(await statusOf(failing), 'partially_applied', 'some failed');

    const nothing = await proposal(me);
    await apply(me, [{ op: 'delete', workoutId: randomUUID() }], nothing);
    assert.equal(await statusOf(nothing), 'pending', 'nothing applied → unchanged');

    const foreign = await proposal(other);
    await apply(me, [changes[1]], foreign);
    assert.equal(await statusOf(foreign), 'pending', "other user's proposal untouched");
  });

  test('svc_apply_plan_changes: service role only, acts for the given user', async () => {
    await assert.rejects(
      t.asUser(me, `select public.svc_apply_plan_changes($1, '[]'::jsonb, null)`, [me]),
      pgError({ code: '42501' }),
    );
    const id = await insertWorkout(other, { date: '2026-11-25', title: 'De other' });
    const [row] = await t.asService<{ r: ApplyJson }>(
      'select public.svc_apply_plan_changes($1, $2::jsonb, null) as r',
      [other, JSON.stringify([{ op: 'update', workoutId: id, patch: { title: 'Por Claude' }, reason: 'r' }])],
    );
    assert.deepEqual(row?.r, { applied: 1, failed: [] });
    await assert.rejects(
      t.asService(`select public.svc_apply_plan_changes($1, '[]'::jsonb, null)`, [randomUUID()]),
      pgError({ hint: 'not_authenticated' }),
    );
  });

  test('claude / ai_coach proposals notify the owner with a deep link', async () => {
    const changes = [
      { op: 'add', workout: { date: '2026-11-22', sport: 'run', title: 'A', durationMin: 40, intensity: 'endurance' }, reason: 'r' },
      { op: 'add', workout: { date: '2026-11-23', sport: 'run', title: 'B', durationMin: 40, intensity: 'endurance' }, reason: 'r' },
    ];
    const [claude] = await t.asService<{ id: string }>(
      `insert into public.plan_proposals (user_id, kind, source, week_start, summary, changes)
       values ($1, 'replan', 'claude', '2026-11-16', 'Muevo la tirada por el pádel', $2::jsonb) returning id`,
      [me, JSON.stringify(changes)],
    );
    await t.asUser(me, `insert into public.plan_proposals (kind, source, week_start, changes) values ('replan', 'rules', '2026-11-16', $1::jsonb)`, [JSON.stringify(changes)]);
    await t.asService(
      `insert into public.plan_proposals (user_id, kind, source, week_start, changes) values ($1, 'chat', 'ai_coach', '2026-11-16', '[]')`,
      [me],
    );
    const rows = await t.asUser<{ title: string; body: string; data: { url: string; proposalId: string } }>(
      me,
      `select title, body, data from public.notifications where type = 'plan_updated'`,
    );
    assert.equal(rows.length, 1, 'rules proposals and empty proposals do not notify');
    assert.equal(rows[0]?.title, 'Tu semana tiene 2 cambios propuestos');
    assert.equal(rows[0]?.body, 'Muevo la tirada por el pádel');
    assert.equal(rows[0]?.data.url, `/proposal/${claude?.id}`);
  });

  describe('v4: coaching and step targets', () => {
    const coachingOf = async (id: string): Promise<Coaching | null | undefined> =>
      (await t.admin<{ coaching: Coaching | null }>('select coaching from public.workouts where id = $1', [id]))[0]?.coaching;
    const idByTitle = async (user: string, title: string): Promise<string> => {
      const [row] = await t.admin<{ id: string }>('select id from public.workouts where user_id = $1 and title = $2', [user, title]);
      assert.ok(row?.id, `workout «${title}» exists`);
      return row.id;
    };
    const draft = (title: string, extra: Record<string, unknown> = {}) => ({
      date: '2026-12-01',
      sport: 'run',
      title,
      durationMin: 60,
      intensity: 'threshold',
      ...extra,
    });

    test('add stores a trimmed copy with the known keys only; absent or null coaching means none', async () => {
      const result = await apply(me, [
        { op: 'add', workout: draft('Umbral con pautas', { coaching: COACHING_INPUT }), reason: 'r' },
        { op: 'add', workout: draft('Sin pautas'), reason: 'r' },
        { op: 'add', workout: draft('Pautas nulas', { coaching: null }), reason: 'r' },
        { op: 'add', workout: draft('Pautas mínimas', { coaching: { objective: 'Rodar suave', success: 'Terminar con ganas' } }), reason: 'r' },
      ]);
      assert.deepEqual(result, { applied: 4, failed: [] });
      assert.deepEqual(await coachingOf(await idByTitle(me, 'Umbral con pautas')), COACHING_STORED);
      assert.equal(await coachingOf(await idByTitle(me, 'Sin pautas')), null);
      assert.equal(await coachingOf(await idByTitle(me, 'Pautas nulas')), null);
      assert.deepEqual(await coachingOf(await idByTitle(me, 'Pautas mínimas')), {
        objective: 'Rodar suave',
        keys: [],
        success: 'Terminar con ganas',
        planB: null,
      });

      // Claude (MCP) and the AI coach go through the service-role variant.
      const [row] = await t.asService<{ r: ApplyJson }>('select public.svc_apply_plan_changes($1, $2::jsonb, null) as r', [
        other,
        JSON.stringify([{ op: 'add', workout: draft('Pautas de Claude', { coaching: COACHING_INPUT, source: 'claude' }), reason: 'r' }]),
      ]);
      assert.deepEqual(row?.r, { applied: 1, failed: [] });
      assert.deepEqual(await coachingOf(await idByTitle(other, 'Pautas de Claude')), COACHING_STORED);
    });

    test('update replaces coaching, a patch without it keeps it and null clears it', async () => {
      const id = await insertWorkout(me, { date: '2026-12-02', title: 'Para pautar' });
      assert.deepEqual(await apply(me, [{ op: 'update', workoutId: id, patch: { coaching: COACHING_INPUT }, reason: 'r' }]), {
        applied: 1,
        failed: [],
      });
      assert.deepEqual(await coachingOf(id), COACHING_STORED);

      await apply(me, [{ op: 'update', workoutId: id, patch: { title: 'Umbral', durationMin: 50 }, reason: 'r' }]);
      assert.deepEqual(await coachingOf(id), COACHING_STORED, 'absent = unchanged');

      const easier: Coaching = { objective: 'Soltar piernas', keys: [], success: 'FC por debajo de 140 ppm', planB: null };
      await apply(me, [{ op: 'update', workoutId: id, patch: { coaching: easier }, reason: 'r' }]);
      assert.deepEqual(await coachingOf(id), easier);

      await apply(me, [{ op: 'update', workoutId: id, patch: { coaching: null }, reason: 'r' }]);
      assert.equal(await coachingOf(id), null, 'null = clear');

      // A new intensity (or sport) without new coaching would keep an objective written for the old session.
      await apply(me, [{ op: 'update', workoutId: id, patch: { coaching: COACHING_INPUT }, reason: 'r' }]);
      await apply(me, [{ op: 'update', workoutId: id, patch: { intensity: 'vo2' }, reason: 'r' }]);
      assert.equal(await coachingOf(id), null, 'new intensity without coaching = cleared');
      await apply(me, [{ op: 'update', workoutId: id, patch: { intensity: 'recovery', coaching: easier }, reason: 'r' }]);
      assert.deepEqual(await coachingOf(id), easier, 'new intensity with coaching = replaced');

      const done = await insertWorkout(me, { date: '2026-11-28', title: 'Hecho con pautas', status: 'completed' });
      await apply(me, [{ op: 'update', workoutId: done, patch: { coaching: easier }, reason: 'r' }]);
      assert.deepEqual(await coachingOf(done), easier, 'completed workouts take coaching through update');
    });

    test('invalid coaching is reported per change in Spanish and never stored', async () => {
      const kept = await insertWorkout(me, { date: '2026-12-03', title: 'Con pautas buenas' });
      await apply(me, [{ op: 'update', workoutId: kept, patch: { coaching: COACHING_INPUT }, reason: 'r' }]);

      const valid: Coaching = { objective: 'Rodar', keys: ['Cadencia alta'], success: 'Sin molestias', planB: null };
      const objective = 'Objetivo del entreno no válido (1–200 caracteres)';
      const keys = 'Claves del entreno no válidas (1–160 caracteres cada una)';
      const success = 'Criterio de éxito no válido (1–200 caracteres)';
      const planB = 'Plan B no válido (1–200 caracteres)';
      const emoji = (n: number): string => '💪'.repeat(n);
      const cases: [unknown, string][] = [
        ['Rodar suave', 'Indicaciones del entreno no válidas'],
        [[valid], 'Indicaciones del entreno no válidas'],
        [{ ...valid, objective: '   ' }, objective],
        [{ ...valid, objective: 'x'.repeat(201) }, objective],
        [{ keys: [], success: 'Sin molestias', planB: null }, objective],
        [{ ...valid, objective: 7 }, objective],
        [{ ...valid, keys: ['1', '2', '3', '4', '5'] }, 'Máximo 4 claves por entreno'],
        [{ ...valid, keys: ['Cadencia alta', ''] }, keys],
        [{ ...valid, keys: ['x'.repeat(161)] }, keys],
        [{ ...valid, keys: [42] }, keys],
        [{ ...valid, keys: 'Cadencia alta' }, keys],
        [{ ...valid, success: '' }, success],
        [{ objective: 'Rodar', keys: [], planB: null }, success],
        [{ ...valid, success: 'x'.repeat(201) }, success],
        [{ ...valid, planB: '  ' }, planB],
        [{ ...valid, planB: 'x'.repeat(201) }, planB],
        [{ ...valid, planB: false }, planB],
        [
          { objective: emoji(200), keys: [emoji(160), emoji(160), emoji(160), emoji(160)], success: emoji(200), planB: emoji(200) },
          'Indicaciones del entreno demasiado largas',
        ],
      ];
      const atLimit: Coaching = {
        objective: 'o'.repeat(200),
        keys: ['a', 'b', 'c', 'd'].map((k) => k.repeat(160)),
        success: 's'.repeat(200),
        planB: 'p'.repeat(200),
      };
      const result = await apply(me, [
        ...cases.map(([coaching]) => ({ op: 'add', workout: draft('Pautas inválidas', { coaching }), reason: 'r' })),
        { op: 'update', workoutId: kept, patch: { title: 'No cambia', coaching: { ...valid, objective: '' } }, reason: 'r' },
        { op: 'add', workout: draft('Pautas al límite', { coaching: atLimit }), reason: 'r' },
      ]);

      assert.equal(result.applied, 1);
      assert.deepEqual(result.failed, [
        ...cases.map(([, error], index) => ({ index, error })),
        { index: cases.length, error: objective },
      ]);
      const [invalid] = await t.admin<{ n: number }>(
        `select count(*)::int as n from public.workouts where user_id = $1 and title = 'Pautas inválidas'`,
        [me],
      );
      assert.equal(invalid?.n, 0);
      const [row] = await t.admin<{ title: string; coaching: Coaching }>('select title, coaching from public.workouts where id = $1', [kept]);
      assert.deepEqual(row, { title: 'Con pautas buenas', coaching: COACHING_STORED }, 'a failed update changes nothing');
      assert.deepEqual(await coachingOf(await idByTitle(me, 'Pautas al límite')), atLimit);
    });

    test('steps keep explicit targets, cues and brick legs verbatim; at most 50 steps', async () => {
      const result = await apply(me, [
        { op: 'add', workout: draft('Series con objetivos', { steps: RUN_STEPS }), reason: 'r' },
        { op: 'add', workout: draft('Cincuenta pasos', { steps: Array.from({ length: 50 }, () => ({ kind: 'work', durationMin: 1 })) }), reason: 'r' },
        { op: 'add', workout: draft('Demasiados', { steps: Array.from({ length: 51 }, () => ({ kind: 'work', durationMin: 1 })) }), reason: 'r' },
      ]);
      assert.deepEqual(result, { applied: 2, failed: [{ index: 2, error: 'Demasiados pasos (máximo 50)' }] });
      const id = await idByTitle(me, 'Series con objetivos');
      const stepsOf = async (): Promise<unknown> =>
        (await t.admin<{ steps: unknown }>('select steps from public.workouts where id = $1', [id]))[0]?.steps;
      assert.deepEqual(await stepsOf(), RUN_STEPS);

      const updated = await apply(me, [
        { op: 'update', workoutId: id, patch: { sport: 'brick', title: 'Transición', steps: BRICK_STEPS }, reason: 'r' },
        { op: 'update', workoutId: id, patch: { steps: Array.from({ length: 51 }, () => ({ kind: 'rest' })) }, reason: 'r' },
      ]);
      assert.deepEqual(updated, { applied: 1, failed: [{ index: 1, error: 'Demasiados pasos (máximo 50)' }] });
      assert.deepEqual(await stepsOf(), BRICK_STEPS);
    });

    test('workouts.coaching only holds an object of at most 4000 bytes (direct writes too)', async () => {
      const insert = (coaching: unknown) =>
        t.asUser(
          me,
          `insert into public.workouts (date, sport, title, duration_min, intensity, coaching)
           values ('2026-12-05', 'run', 'Directo', 40, 'endurance', $1::jsonb) returning id`,
          [JSON.stringify(coaching)],
        );
      await assert.rejects(insert(['Rodar']), pgError({ code: '23514' }));
      await assert.rejects(insert('Rodar'), pgError({ code: '23514' }));
      await assert.rejects(insert({ ...COACHING_STORED, objective: 'x'.repeat(5000) }), pgError({ code: '23514' }));
      assert.equal((await insert(COACHING_STORED)).length, 1);
    });
  });
});
