/**
 * 20261127000500_plan_import.sql: apply_plan_import creates the import and its
 * planned workouts (source 'imported') atomically, replaces the sessions the
 * app planned itself in those weeks, validates like apply_plan_changes;
 * delete_plan_import removes the import and its planned sessions only; RLS.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface ApplyJson {
  import: { id: string; source: string; title: string; startDate: string; endDate: string; sessionCount: number; confidence: string };
  added: number;
  replaced: number;
}

function madridDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const draft = (date: string, title = 'Rodaje Z2', extra: Record<string, unknown> = {}) => ({
  date,
  sport: 'run',
  title,
  durationMin: 45,
  intensity: 'endurance',
  steps: [{ kind: 'work', durationMin: 45, intensity: 'endurance' }],
  source: 'imported',
  ...extra,
});

describe('plan import', () => {
  let t: TestDb;
  let me: string;
  let other: string;

  const meta = { source: 'csv', title: 'Plan del entrenador', confidence: 'high', plan: { sessions: [] } };
  const apply = async (user: string, workouts: unknown[], replace = true, importMeta: unknown = meta): Promise<ApplyJson> => {
    const [row] = await t.asUser<{ r: ApplyJson }>(user, 'select public.apply_plan_import($1::jsonb, $2::jsonb, $3) as r', [
      JSON.stringify(importMeta),
      JSON.stringify(workouts),
      replace,
    ]);
    assert.ok(row);
    return row.r;
  };
  const insertWorkout = async (date: string, source: string, extra = '') => {
    const [row] = await t.admin<{ id: string }>(
      `insert into public.workouts (user_id, date, sport, title, duration_min, intensity, status, source)
       values ($1, $2, 'bike', $3, 60, 'endurance', 'planned', $4) returning id`,
      [me, date, `${source}${extra}`, source],
    );
    assert.ok(row?.id);
    return row.id;
  };
  const count = async (sql: string, params: unknown[] = []) => (await t.admin<{ n: number }>(sql, params))[0]?.n ?? -1;

  before(async () => {
    t = await createTestDb();
    me = await t.createUser({ email: 'imports@example.com' });
    other = await t.createUser({ email: 'other-imports@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('apply creates the import + imported workouts and replaces only app-planned sessions of those weeks', async () => {
    const day = madridDate(1);
    const later = madridDate(30);
    const rules = await insertWorkout(day, 'rules');
    const manual = await insertWorkout(day, 'manual');
    const farRules = await insertWorkout(madridDate(60), 'rules');
    const result = await apply(me, [draft(day), draft(later, 'Tirada larga', { durationMin: 100 })]);
    assert.equal(result.added, 2);
    assert.equal(result.replaced, 1);
    assert.equal(result.import.title, 'Plan del entrenador');
    assert.equal(result.import.startDate, day);
    assert.equal(result.import.endDate, later);
    assert.equal(result.import.sessionCount, 2);
    const rows = await t.admin<{ source: string; plan_import_id: string; steps: unknown[] }>(
      `select source, plan_import_id, steps from public.workouts where user_id = $1 and source = 'imported' order by date`,
      [me],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.plan_import_id === result.import.id && r.steps.length === 1));
    assert.equal(await count('select count(*)::int as n from public.workouts where id = $1', [rules]), 0, 'rules session replaced');
    assert.equal(await count('select count(*)::int as n from public.workouts where id = $1', [manual]), 1, 'own session kept');
    assert.equal(await count('select count(*)::int as n from public.workouts where id = $1', [farRules]), 1, 'other weeks untouched');
  });

  test('apply without replace keeps everything', async () => {
    const day = madridDate(90);
    const rules = await insertWorkout(day, 'rules', '-keep');
    const result = await apply(me, [draft(day)], false);
    assert.equal(result.replaced, 0);
    assert.equal(await count('select count(*)::int as n from public.workouts where id = $1', [rules]), 1);
  });

  test('validation: past dates, bad sessions, bad metadata, nothing to import (all or nothing)', async () => {
    const before = await count(`select count(*)::int as n from public.plan_imports where user_id = $1`, [me]);
    await assert.rejects(apply(me, [draft(madridDate(2)), draft(madridDate(-1))]), pgError({ code: '22023', message: 'La fecha ya ha pasado' }));
    await assert.rejects(apply(me, [draft(madridDate(2), 'x', { sport: 'golf' })]), pgError({ code: '22023', message: 'Deporte no válido' }));
    await assert.rejects(apply(me, []), pgError({ code: '22023' }));
    await assert.rejects(apply(me, [draft(madridDate(2))], true, { ...meta, source: 'fax' }), pgError({ code: '22023' }));
    await assert.rejects(apply(me, [draft(madridDate(2))], true, { ...meta, title: '  ' }), pgError({ code: '22023' }));
    assert.equal(await count(`select count(*)::int as n from public.plan_imports where user_id = $1`, [me]), before);
  });

  test('RLS: own imports only, no direct writes, no links to another athlete’s import', async () => {
    const mine = await apply(me, [draft(madridDate(120))]);
    const seenByOther = await t.asUser<{ id: string }>(other, 'select id from public.plan_imports');
    assert.equal(seenByOther.length, 0);
    const seenByMe = await t.asUser<{ id: string }>(me, 'select id from public.plan_imports where id = $1', [mine.import.id]);
    assert.equal(seenByMe.length, 1);
    await assert.rejects(
      t.asUser(other, `insert into public.plan_imports (user_id, source, title, start_date, end_date, session_count, confidence) values ($1, 'csv', 'x', current_date, current_date, 1, 'high')`, [other]),
      pgError({ code: '42501' }),
    );
    const [w] = await t.admin<{ id: string }>(
      `insert into public.workouts (user_id, date, sport, title, duration_min, intensity) values ($1, current_date + 3, 'run', 'Mío', 30, 'endurance') returning id`,
      [other],
    );
    await assert.rejects(
      t.asUser(other, 'update public.workouts set plan_import_id = $1 where id = $2', [mine.import.id, w?.id]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(t.asUser(other, 'select public.delete_plan_import($1)', [mine.import.id]), pgError({ code: 'P0002' }));
  });

  test('delete removes the import and its planned sessions; done sessions stay unlinked', async () => {
    const result = await apply(me, [draft(madridDate(150), 'A'), draft(madridDate(151), 'B')]);
    await t.admin(`update public.workouts set status = 'completed' where plan_import_id = $1 and title = 'B'`, [result.import.id]);
    const [row] = await t.asUser<{ n: number }>(me, 'select public.delete_plan_import($1) as n', [result.import.id]);
    assert.equal(row?.n, 1);
    assert.equal(await count('select count(*)::int as n from public.plan_imports where id = $1', [result.import.id]), 0);
    const kept = await t.admin<{ title: string; plan_import_id: string | null; source: string }>(
      `select title, plan_import_id, source from public.workouts where user_id = $1 and title in ('A', 'B')`,
      [me],
    );
    assert.deepEqual(kept, [{ title: 'B', plan_import_id: null, source: 'imported' }]);
  });

  test('apply_plan_changes keeps the imported source when the re-planner moves a session', async () => {
    const result = await apply(me, [draft(madridDate(200), 'Mover')]);
    const [w] = await t.admin<{ id: string }>(`select id from public.workouts where plan_import_id = $1`, [result.import.id]);
    const changes = [{ op: 'move', workoutId: w?.id, toDate: madridDate(201), reason: 'Lluvia' }];
    await t.asUser(me, 'select public.apply_plan_changes($1::jsonb, null)', [JSON.stringify(changes)]);
    const [moved] = await t.admin<{ source: string; plan_import_id: string }>('select source, plan_import_id from public.workouts where id = $1', [w?.id]);
    assert.deepEqual(moved, { source: 'imported', plan_import_id: result.import.id });
  });
});
