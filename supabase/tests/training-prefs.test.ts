/**
 * «Tu forma de entrenar» (20261128000700_training_prefs.sql): profiles.training_prefs is null
 * until chosen, the owner writes and clears it, the outline and size are checked, and nobody else
 * reads or changes it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

const PREFS = {
  sessionsPerWeek: { swim: 3, strength: 1 },
  preferredDays: { swim: [0, 2] },
  longRideDays: [5],
  longRunDays: [6],
  intensityModel: 'polarized',
  fixedSessions: [{ sport: 'swim', weekday: 1, startTime: '20:00', durationMin: 60, title: 'Natación del club' }],
};

describe('profiles.training_prefs («Tu forma de entrenar»)', () => {
  let t: TestDb;
  let user: string;
  let other: string;

  const prefsOf = async (id: string): Promise<unknown> =>
    (await t.admin<{ training_prefs: unknown }>('select training_prefs from public.profiles where id = $1', [id]))[0]?.training_prefs;
  const setPrefs = (as: string, id: string, prefs: unknown) =>
    t.asUser(as, 'update public.profiles set training_prefs = $2::jsonb where id = $1 returning 1', [id, prefs === null ? null : JSON.stringify(prefs)]);

  before(async () => {
    t = await createTestDb();
    user = await t.createUser({ email: 'prefs-a@example.com' });
    other = await t.createUser({ email: 'prefs-b@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('null until chosen (automático); the owner saves, reads back and clears it', async () => {
    assert.equal(await prefsOf(user), null);
    await setPrefs(user, user, PREFS);
    assert.deepEqual(await prefsOf(user), PREFS);
    const [own] = await t.asUser<{ training_prefs: unknown }>(user, 'select training_prefs from public.profiles');
    assert.deepEqual(own?.training_prefs, PREFS, 'the owner reads it back');
    await setPrefs(user, user, {});
    assert.deepEqual(await prefsOf(user), {}, 'an empty object is everything automático too');
    await setPrefs(user, user, null);
    assert.equal(await prefsOf(user), null);
  });

  test('the outline and the size are checked', async () => {
    const bad: [string, unknown][] = [
      ['not an object', [1, 2]],
      ['a string', 'polarizado'],
      ['unknown intensity model', { ...PREFS, intensityModel: 'a tope' }],
      ['sessions as a list', { ...PREFS, sessionsPerWeek: [3] }],
      ['days as an object', { ...PREFS, longRunDays: { d: 6 } }],
      ['too many fixed sessions', { ...PREFS, fixedSessions: Array.from({ length: 11 }, () => PREFS.fixedSessions[0]) }],
      ['too big', { ...PREFS, notes: 'x'.repeat(9000) }],
    ];
    for (const [label, prefs] of bad) {
      await assert.rejects(setPrefs(user, user, prefs), pgError({ code: '23514' }), label);
    }
    await setPrefs(user, user, { intensityModel: 'pyramidal' });
    assert.deepEqual(await prefsOf(user), { intensityModel: 'pyramidal' }, 'missing keys = automático');
  });

  test('private: nobody else reads or changes it; only authenticated owners write it', async () => {
    await setPrefs(user, user, PREFS);
    const changed = await setPrefs(other, user, { intensityModel: 'auto' });
    assert.equal(changed.length, 0, 'nobody else changes it');
    const seen = await t.asUser<{ training_prefs: unknown }>(other, 'select training_prefs from public.profiles where id = $1', [user]);
    assert.equal(seen.length, 0, 'nobody else reads it');
    assert.deepEqual(await prefsOf(user), PREFS);

    const [grants] = await t.admin<{ update: boolean; anon_select: boolean; anon_update: boolean }>(
      `select has_column_privilege('authenticated', 'public.profiles', 'training_prefs', 'update') as update,
              has_column_privilege('anon', 'public.profiles', 'training_prefs', 'select') as anon_select,
              has_column_privilege('anon', 'public.profiles', 'training_prefs', 'update') as anon_update`,
    );
    assert.deepEqual(grants, { update: true, anon_select: false, anon_update: false });
  });
});
