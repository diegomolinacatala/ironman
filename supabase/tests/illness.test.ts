/**
 * 20261128000300_illness_signal.sql: night breathing / heart rate on daily_metrics and the
 * answer to the morning illness question on daily_checkins.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('illness signal columns', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'illness-alice@example.com' });
    bob = await t.createUser({ email: 'illness-bob@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('owners write sleep respiration and sleep HR; implausible values are rejected', async () => {
    await t.asUser(alice, `insert into public.daily_metrics (date, source, sleep_respiration, sleep_avg_hr) values ($1, 'garmin', 14.6, 52)`, [
      isoDay(0),
    ]);
    const [row] = await t.asUser<{ sleep_respiration: string; sleep_avg_hr: string }>(
      alice,
      'select sleep_respiration, sleep_avg_hr from public.daily_metrics',
    );
    assert.equal(Number(row?.sleep_respiration), 14.6);
    assert.equal(Number(row?.sleep_avg_hr), 52);
    await assert.rejects(
      t.asUser(alice, `insert into public.daily_metrics (date, source, sleep_respiration) values ($1, 'healthkit', 60)`, [isoDay(-1)]),
      pgError({ code: '23514' }),
    );
    const others = await t.asUser(bob, 'select 1 from public.daily_metrics');
    assert.equal(others.length, 0);
  });

  test('the check-in stores one of the five answers (or none)', async () => {
    const insert = (date: string, answer: string | null) =>
      t.asUser(
        alice,
        `insert into public.daily_checkins (date, sleep_quality, fatigue, soreness, stress, motivation, illness_answer)
         values ($1, 3, 3, 2, 2, 4, $2)`,
        [date, answer],
      );
    await insert(isoDay(0), 'symptoms');
    await insert(isoDay(-1), null);
    const rows = await t.asUser<{ illness_answer: string | null }>(alice, 'select illness_answer from public.daily_checkins order by date');
    assert.deepEqual(
      rows.map((r) => r.illness_answer),
      [null, 'symptoms'],
    );
    await assert.rejects(insert(isoDay(-2), 'flu'), pgError({ code: '23514' }));
  });
});
