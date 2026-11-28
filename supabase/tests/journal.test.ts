/**
 * Journal + post-workout analysis migration (20261127001000_journal_and_analysis.sql):
 * optional 1–5 scales and yes/no `habits` on daily_checkins, profiles.journal_habits,
 * and workout_analyses (owner reads, only the service role writes).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('morning journal and workout analyses', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('daily_checkins: journal answers alone are a valid check-in; old rows keep their scales', async () => {
    const user = await t.createUser({ email: 'journal-checkin@example.com' });
    const day = isoDay(0);
    await t.asUser(user, `insert into public.daily_checkins (date, habits) values ($1, $2::jsonb)`, [
      day,
      JSON.stringify({ alcohol: true, niggle: false }),
    ]);
    await t.asUser(user, `insert into public.daily_checkins (date, sleep_quality, fatigue, soreness, stress, motivation) values ($1, 4, 2, 2, 3, 4)`, [
      isoDay(-1),
    ]);
    const rows = await t.asUser<{ date: string; habits: Record<string, boolean>; fatigue: number | null }>(
      user,
      `select to_char(date, 'YYYY-MM-DD') as date, habits, fatigue from public.daily_checkins order by date`,
    );
    assert.deepEqual(rows, [
      { date: isoDay(-1), habits: {}, fatigue: 2 },
      { date: day, habits: { alcohol: true, niggle: false }, fatigue: null },
    ]);
    for (const habits of ['[]', '"si"', '5']) {
      await assert.rejects(
        t.asUser(user, `insert into public.daily_checkins (date, habits) values ($1, $2::jsonb)`, [isoDay(-2), habits]),
        pgError({ code: '23514' }),
        `habits ${habits}`,
      );
    }
  });

  test('profiles.journal_habits: the owner sets and clears it; empty lists are rejected', async () => {
    const user = await t.createUser({ email: 'journal-habits@example.com' });
    const other = await t.createUser({ email: 'journal-habits-other@example.com' });
    const habitsOf = async (id: string): Promise<string[] | null | undefined> =>
      (await t.admin<{ journal_habits: string[] | null }>('select journal_habits from public.profiles where id = $1', [id]))[0]?.journal_habits;

    assert.equal(await habitsOf(user), null, 'null = the defaults');
    const five = ['alcohol', 'late_meal', 'sick', 'nap', 'travel'];
    await t.asUser(user, 'update public.profiles set journal_habits = $2 where id = $1', [user, five]);
    assert.deepEqual(await habitsOf(user), five);
    await assert.rejects(
      t.asUser(user, `update public.profiles set journal_habits = '{}' where id = $1`, [user]),
      pgError({ code: '23514' }),
    );
    const changed = await t.asUser(other, `update public.profiles set journal_habits = '{alcohol}' where id = $1 returning 1`, [user]);
    assert.equal(changed.length, 0, 'nobody else changes it');
    await t.asUser(user, 'update public.profiles set journal_habits = null where id = $1', [user]);
    assert.equal(await habitsOf(user), null);
  });

  test('workout_analyses: the owner reads its analysis, cannot write it, and it goes with the workout', async () => {
    const user = await t.createUser({ email: 'analysis-owner@example.com' });
    const other = await t.createUser({ email: 'analysis-other@example.com' });
    const [workout] = await t.asUser<{ id: string }>(
      user,
      `insert into public.workouts (date, sport, title, duration_min, intensity, status) values ($1, 'run', 'Rodaje', 45, 'endurance', 'completed') returning id`,
      [isoDay(0)],
    );
    assert.ok(workout);
    await t.asService(
      `insert into public.workout_analyses (workout_id, user_id, headline, went_well, improve, next_step, model)
       values ($1, $2, 'Rodaje bien controlado', '{"FC estable"}', '{}', 'Mañana, suave.', 'qwen')`,
      [workout.id, user],
    );
    const own = await t.asUser<{ headline: string }>(user, 'select headline from public.workout_analyses');
    assert.deepEqual(own, [{ headline: 'Rodaje bien controlado' }]);
    assert.deepEqual(await t.asUser(other, 'select headline from public.workout_analyses'), [], 'nobody else reads it');
    await assert.rejects(
      t.asUser(user, `insert into public.workout_analyses (workout_id, user_id, headline) values ($1, $2, 'x')`, [workout.id, user]),
      pgError({ code: '42501' }),
      'no client writes',
    );
    await t.asUser(user, 'delete from public.workouts where id = $1', [workout.id]);
    const left = await t.admin('select 1 from public.workout_analyses where workout_id = $1', [workout.id]);
    assert.equal(left.length, 0, 'deleted with its workout');
  });
});
