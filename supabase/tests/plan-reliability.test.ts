/**
 * 20261122000400_plan_reliability.sql: no plan change lands in the past on
 * apply, a new proposal supersedes stale pending rules proposals, and
 * proposals stored already applied (Claude's apply_now) do not notify.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { applyPlanChanges } from '../../src/domain/changes.ts';
import { createTestDb } from './harness.ts';
import type { TestDb } from './harness.ts';

interface ApplyJson {
  applied: number;
  failed: { index: number; error: string }[];
}

/** Local date in Madrid (profiles.timezone default), shifted by `days`. */
function madridDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

describe('plan reliability', () => {
  let t: TestDb;
  let me: string;

  const insertWorkout = async (date: string, title: string) => {
    const [row] = await t.admin<{ id: string }>(
      `insert into public.workouts (user_id, date, sport, title, duration_min, intensity, status)
       values ($1, $2, 'run', $3, 45, 'endurance', 'planned') returning id`,
      [me, date, title],
    );
    assert.ok(row?.id);
    return row.id;
  };
  const apply = async (changes: unknown): Promise<ApplyJson> => {
    const [row] = await t.asUser<{ r: ApplyJson }>(me, 'select public.apply_plan_changes($1::jsonb, null) as r', [JSON.stringify(changes)]);
    assert.ok(row);
    return row.r;
  };
  const dateOf = async (id: string) => (await t.admin<{ date: string }>('select date::text as date from public.workouts where id = $1', [id]))[0]?.date;

  before(async () => {
    t = await createTestDb();
    me = await t.createUser({ email: 'reliable@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('apply refuses adds, moves and date updates into the past (same message as the app)', async () => {
    const yesterday = madridDate(-1);
    const today = madridDate(0);
    const soon = madridDate(3);
    const future = await insertWorkout(soon, 'Futuro');
    const missed = await insertWorkout(madridDate(-2), 'Saltado');
    const changes = [
      { op: 'add', workout: { date: yesterday, sport: 'run', title: 'Ayer', durationMin: 30, intensity: 'endurance' }, reason: 'r' },
      { op: 'move', workoutId: future, toDate: yesterday, reason: 'r' },
      { op: 'update', workoutId: future, patch: { date: yesterday }, reason: 'r' },
      { op: 'move', workoutId: missed, toDate: today, reason: 'r' },
      { op: 'add', workout: { date: today, sport: 'run', title: 'Hoy', durationMin: 30, intensity: 'endurance' }, reason: 'r' },
    ];
    const result = await apply(changes);
    assert.deepEqual(result, {
      applied: 2,
      failed: [
        { index: 0, error: 'La fecha ya ha pasado' },
        { index: 1, error: 'La fecha ya ha pasado' },
        { index: 2, error: 'La fecha ya ha pasado' },
      ],
    });
    assert.equal(await dateOf(future), soon, 'the refused move is rolled back');
    assert.equal(await dateOf(missed), today, 'a missed session can still come back to today');
    const [ayer] = await t.admin<{ n: number }>(`select count(*)::int as n from public.workouts where user_id = $1 and title = 'Ayer'`, [me]);
    assert.equal(ayer?.n, 0);

    // The app predicts the same failures when it knows today.
    const local = applyPlanChanges(
      [
        { id: future, userId: me, date: soon, startTime: null, sport: 'run', title: 'Futuro', description: null, durationMin: 45, distanceM: null, intensity: 'endurance', tss: null, steps: [], status: 'planned', completed: null, source: 'manual', isKey: false, jointSessionId: null, externalId: null, createdAt: '', updatedAt: '' },
      ],
      changes.slice(0, 3) as Parameters<typeof applyPlanChanges>[1],
      { userId: me, now: '', newId: () => 'n', today },
    );
    assert.deepEqual(local.failed, result.failed);
  });

  test('a new proposal discards older pending rules proposals of an overlapping window', async () => {
    const insert = async (source: string, weekStart: string, status = 'pending') => {
      const [row] = await t.admin<{ id: string }>(
        `insert into public.plan_proposals (user_id, kind, source, week_start, changes, status)
         values ($1, 'replan', $2, $3, '[{"op":"delete","workoutId":"x","reason":"r"}]'::jsonb, $4) returning id`,
        [me, source, weekStart, status],
      );
      assert.ok(row?.id);
      return row.id;
    };
    const statusOf = async (id: string) => (await t.admin<{ status: string }>('select status from public.plan_proposals where id = $1', [id]))[0]?.status;

    const oldRules = await insert('rules', '2036-11-03');
    const overlapping = await insert('rules', '2036-11-10');
    const farAway = await insert('rules', '2036-12-29');
    const claude = await insert('claude', '2036-11-03');
    assert.equal(await statusOf(oldRules), 'discarded', 'superseded by the next rules proposal');
    assert.equal(await statusOf(overlapping), 'discarded', 'superseded by the claude proposal (windows overlap)');
    assert.equal(await statusOf(farAway), 'pending', 'other window untouched');
    assert.equal(await statusOf(claude), 'pending', 'only rules proposals are superseded');
  });

  test('a proposal stored already applied (apply_now) does not notify; a pending one does', async () => {
    const count = async () =>
      (await t.admin<{ n: number }>(`select count(*)::int as n from public.notifications where user_id = $1 and type = 'plan_updated'`, [me]))[0]?.n ?? 0;
    const before = await count();
    const changes = JSON.stringify([{ op: 'delete', workoutId: 'x', reason: 'r' }]);
    await t.asService(
      `insert into public.plan_proposals (user_id, kind, source, week_start, changes, status) values ($1, 'replan', 'claude', '2037-01-05', $2::jsonb, 'applied')`,
      [me, changes],
    );
    assert.equal(await count(), before);
    await t.asService(`insert into public.plan_proposals (user_id, kind, source, week_start, changes) values ($1, 'replan', 'claude', '2037-01-05', $2::jsonb)`, [me, changes]);
    assert.equal(await count(), before + 1);
  });
});
