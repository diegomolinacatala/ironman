import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('unregister_push_token (sign-out cleanup)', () => {
  let t: TestDb;
  let diego: string;
  let alex: string;

  const tokenOwner = async (token: string): Promise<string | null> => {
    const [row] = await t.admin<{ user_id: string }>('select user_id from public.push_tokens where token = $1', [token]);
    return row?.user_id ?? null;
  };

  before(async () => {
    t = await createTestDb();
    diego = await t.createUser({ email: 'diego@example.com' });
    alex = await t.createUser({ email: 'alex@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('removes the caller own token so its pushes stop reaching the device', async () => {
    await t.asUser(diego, `select public.register_push_token('ExponentPushToken[phone]', 'ios')`);
    await t.asUser(diego, `select public.register_push_token('ExponentPushToken[tablet]', 'ios')`);
    await t.asUser(diego, `select public.unregister_push_token('  ExponentPushToken[phone] ')`);
    assert.equal(await tokenOwner('ExponentPushToken[phone]'), null);
    assert.equal(await tokenOwner('ExponentPushToken[tablet]'), diego, 'other devices stay registered');
  });

  test("never removes someone else's token; unknown tokens are a no-op", async () => {
    await t.asUser(alex, `select public.register_push_token('ExponentPushToken[alex]', 'ios')`);
    await t.asUser(diego, `select public.unregister_push_token('ExponentPushToken[alex]')`);
    assert.equal(await tokenOwner('ExponentPushToken[alex]'), alex);
    await t.asUser(diego, `select public.unregister_push_token('ExponentPushToken[nope]')`);
  });

  test('validates the token and requires a signed-in caller', async () => {
    await assert.rejects(t.asUser(diego, `select public.unregister_push_token('  ')`), pgError({ hint: 'validation' }));
    await assert.rejects(t.asUser(diego, 'select public.unregister_push_token(null)'), pgError({ hint: 'validation' }));
    await assert.rejects(
      t.asUser(diego, 'select public.unregister_push_token($1)', ['x'.repeat(301)]),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asAnon(`select public.unregister_push_token('ExponentPushToken[alex]')`),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query(`select public.unregister_push_token('ExponentPushToken[alex]')`);
      }),
      pgError({ hint: 'not_authenticated' }),
    );
    assert.equal(await tokenOwner('ExponentPushToken[alex]'), alex);
  });
});
