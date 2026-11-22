import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('automatic availability (20261122000300)', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('a new profile starts automatic, with no fixed rest day', async () => {
    const user = await t.createUser({ email: 'auto@example.com' });
    const [row] = await t.asUser<{ availability: Record<string, unknown> }>(user, 'select availability from public.profiles where id = $1', [user]);
    assert.equal(row?.availability.mode, 'auto');
    assert.equal(row?.availability.restDay, null);
    assert.deepEqual(row?.availability.windows, []);
  });

  test('the athlete can switch to manual and keep their own hours', async () => {
    const user = await t.createUser({ email: 'manual@example.com' });
    const manual = { mode: 'manual', weeklyHoursTarget: 10, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] };
    await t.asUser(user, 'update public.profiles set availability = $1::jsonb where id = $2', [JSON.stringify(manual), user]);
    const [row] = await t.asUser<{ availability: Record<string, unknown> }>(user, 'select availability from public.profiles where id = $1', [user]);
    assert.deepEqual(row?.availability, manual);
  });
});
