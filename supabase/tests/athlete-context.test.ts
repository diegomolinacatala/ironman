/**
 * «Tu contexto» (20261127000400_athlete_context.sql): profiles.athlete_context is null until the
 * athlete tells the coach anything, the owner writes and clears it, the outline and size are
 * checked, and nobody else reads or changes it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

const CONTEXT = {
  sports: { swim: { background: 'lifelong', goal: 'maintain' }, run: { background: 'some', goal: 'improve_lot' } },
  limitations: 'Rodilla derecha',
  previousRaces: 'Alguna: un sprint',
  occupation: 'both',
  load: 'high',
  schedule: 'morning',
  periods: [{ kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes', eventId: null }],
  habits: {
    breakfast: '07:30',
    lunch: '14:00',
    dinner: '21:30',
    wake: '06:30',
    bed: '23:00',
    weekendsDiffer: true,
    weekendWake: '09:00',
    weekendBed: '00:30',
    preferredTime: 'morning',
  },
  notes: ['Trabajo a turnos'],
  answered: ['swim_bg', 'swim_goal'],
  completedAt: null,
  promptDismissed: false,
};

describe('profiles.athlete_context («Tu contexto»)', () => {
  let t: TestDb;
  let user: string;
  let other: string;

  const contextOf = async (id: string): Promise<unknown> =>
    (await t.admin<{ athlete_context: unknown }>('select athlete_context from public.profiles where id = $1', [id]))[0]?.athlete_context;
  const setContext = (as: string, id: string, ctx: unknown) =>
    t.asUser(as, 'update public.profiles set athlete_context = $2::jsonb where id = $1 returning 1', [id, ctx === null ? null : JSON.stringify(ctx)]);

  before(async () => {
    t = await createTestDb();
    user = await t.createUser({ email: 'context-a@example.com' });
    other = await t.createUser({ email: 'context-b@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('null until told; the owner saves, reads back and clears it', async () => {
    assert.equal(await contextOf(user), null);
    await setContext(user, user, CONTEXT);
    assert.deepEqual(await contextOf(user), CONTEXT);
    const [own] = await t.asUser<{ athlete_context: unknown }>(user, 'select athlete_context from public.profiles');
    assert.deepEqual(own?.athlete_context, CONTEXT, 'the owner reads it back');
    await setContext(user, user, {});
    assert.deepEqual(await contextOf(user), {}, 'an empty object is a context with nothing told');
    await setContext(user, user, null);
    assert.equal(await contextOf(user), null);
  });

  test('the outline and the size are checked', async () => {
    const bad: [string, unknown][] = [
      ['not an object', [1, 2]],
      ['a string', 'estudio'],
      ['unknown occupation', { ...CONTEXT, occupation: 'astronauta' }],
      ['unknown load', { ...CONTEXT, load: 'brutal' }],
      ['sports as a list', { ...CONTEXT, sports: ['swim'] }],
      ['habits as a string', { ...CONTEXT, habits: '07:00' }],
      ['periods as an object', { ...CONTEXT, periods: { a: 1 } }],
      ['too many periods', { ...CONTEXT, periods: Array.from({ length: 9 }, () => CONTEXT.periods[0]) }],
      ['too many notes', { ...CONTEXT, notes: Array.from({ length: 6 }, (_v, i) => `nota ${i}`) }],
      ['too big', { ...CONTEXT, limitations: 'x'.repeat(9000) }],
    ];
    for (const [label, ctx] of bad) {
      await assert.rejects(setContext(user, user, ctx), pgError({ code: '23514' }), label);
    }
    await setContext(user, user, { occupation: null, load: null });
    assert.deepEqual(await contextOf(user), { occupation: null, load: null }, 'nulls and missing keys = not told');
  });

  test('private: nobody else reads or changes it; only authenticated owners write it', async () => {
    await setContext(user, user, CONTEXT);
    const changed = await setContext(other, user, { occupation: 'none' });
    assert.equal(changed.length, 0, 'nobody else changes it');
    const seen = await t.asUser<{ athlete_context: unknown }>(other, 'select athlete_context from public.profiles where id = $1', [user]);
    assert.equal(seen.length, 0, 'nobody else reads it');
    assert.deepEqual(await contextOf(user), CONTEXT);

    const [grants] = await t.admin<{ update: boolean; anon_select: boolean; anon_update: boolean }>(
      `select has_column_privilege('authenticated', 'public.profiles', 'athlete_context', 'update') as update,
              has_column_privilege('anon', 'public.profiles', 'athlete_context', 'select') as anon_select,
              has_column_privilege('anon', 'public.profiles', 'athlete_context', 'update') as anon_update`,
    );
    assert.deepEqual(grants, { update: true, anon_select: false, anon_update: false });
  });
});
