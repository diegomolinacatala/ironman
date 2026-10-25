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
});
