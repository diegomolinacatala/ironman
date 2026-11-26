/**
 * How a B/C race is prepared (20261126000100_race_prep.sql): races.prep is null (the priority's
 * default) or one of training / taper / specific. Owners write it like any other column of their
 * races (own-rows RLS); other users neither see nor change it; the service role (MCP manage_race)
 * writes it too.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface RaceRow {
  id: string;
  priority: string;
  prep: string | null;
}

describe('races.prep (B/C race preparation)', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  const insert = (user: string, priority: string, prep?: string | null): Promise<RaceRow[]> =>
    prep === undefined
      ? t.asUser<RaceRow>(user, `insert into public.races (name, date, distance, priority) values ('Olímpico', $1, 'olympic', $2) returning id::text, priority, prep`, [isoDay(60), priority])
      : t.asUser<RaceRow>(user, `insert into public.races (name, date, distance, priority, prep) values ('Olímpico', $1, 'olympic', $2, $3) returning id::text, priority, prep`, [
          isoDay(60),
          priority,
          prep,
        ]);

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'prep-alice@example.com' });
    bob = await t.createUser({ email: 'prep-bob@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('null by default (the priority decides); the three preparations are accepted', async () => {
    const [plain] = await insert(alice, 'B');
    assert.equal(plain?.prep, null);
    for (const prep of ['training', 'taper', 'specific']) {
      const [row] = await insert(alice, prep === 'taper' ? 'C' : 'B', prep);
      assert.equal(row?.prep, prep);
    }
  });

  test('anything else is rejected by the check constraint', async () => {
    await assert.rejects(insert(alice, 'B', 'a tope'), pgError({ code: '23514' }));
    const [row] = await insert(alice, 'B', 'taper');
    await assert.rejects(t.asUser(alice, `update public.races set prep = 'mucho' where id = $1`, [row?.id]), pgError({ code: '23514' }));
  });

  test('owners change and clear it; other users neither see nor change it', async () => {
    const [row] = await insert(alice, 'B', 'specific');
    const [changed] = await t.asUser<RaceRow>(alice, `update public.races set prep = 'training' where id = $1 returning id::text, priority, prep`, [row?.id]);
    assert.equal(changed?.prep, 'training');
    const [cleared] = await t.asUser<RaceRow>(alice, `update public.races set prep = null where id = $1 returning id::text, priority, prep`, [row?.id]);
    assert.equal(cleared?.prep, null);

    assert.deepEqual(await t.asUser(bob, 'select prep from public.races where id = $1', [row?.id]), [], 'bob does not see it');
    const touched = await t.asUser(bob, `update public.races set prep = 'taper' where id = $1 returning 1`, [row?.id]);
    assert.equal(touched.length, 0, 'bob cannot change it');
    const [stored] = await t.admin<RaceRow>('select id::text, priority, prep from public.races where id = $1', [row?.id]);
    assert.equal(stored?.prep, null);
  });

  test('the service role (manage_race) writes it for the athlete', async () => {
    const [row] = await t.asService<RaceRow>(
      `insert into public.races (user_id, name, date, distance, priority, prep) values ($1, '10K', $2, 'run_10k', 'C', 'taper') returning id::text, priority, prep`,
      [bob, isoDay(40)],
    );
    assert.equal(row?.prep, 'taper');
    assert.deepEqual(await t.asUser<RaceRow>(bob, 'select id::text, priority, prep from public.races where id = $1', [row?.id]), [{ id: row?.id, priority: 'C', prep: 'taper' }]);
  });
});
