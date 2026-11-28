/**
 * «Mis sitios» and the Sunday/Wednesday questions (20261128000800_week_questions_places.sql):
 * profiles.places and profiles.week_questions are null until set, the owner writes and clears
 * them, the outline and size are checked, and nobody else reads or changes them.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

const PLACES = {
  home: { name: 'Valencia', gear: { roadBike: false, trainer: true, pool: true, gym: true } },
  away: { name: 'Castellón', gear: { roadBike: true, trainer: false, pool: false, gym: false } },
};

const QUESTIONS = {
  enabled: true,
  weeks: [{ weekStart: '2026-11-30', priority: 'together', load: 'busy', plans: 'Exámenes el jueves', sundayDone: true, awayWeekend: true, awayRide: true }],
};

describe('profiles.places and profiles.week_questions', () => {
  let t: TestDb;
  let user: string;
  let other: string;

  const columnsOf = async (id: string) =>
    (await t.admin<{ places: unknown; week_questions: unknown }>('select places, week_questions from public.profiles where id = $1', [id]))[0];
  const set = (as: string, id: string, column: 'places' | 'week_questions', value: unknown) =>
    t.asUser(as, `update public.profiles set ${column} = $2::jsonb where id = $1 returning 1`, [id, value === null ? null : JSON.stringify(value)]);

  before(async () => {
    t = await createTestDb();
    user = await t.createUser({ email: 'places-a@example.com' });
    other = await t.createUser({ email: 'places-b@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('null until set; the owner saves, reads back and clears both', async () => {
    assert.deepEqual(await columnsOf(user), { places: null, week_questions: null });
    await set(user, user, 'places', PLACES);
    await set(user, user, 'week_questions', QUESTIONS);
    const [own] = await t.asUser<{ places: unknown; week_questions: unknown }>(user, 'select places, week_questions from public.profiles');
    assert.deepEqual(own, { places: PLACES, week_questions: QUESTIONS });
    await set(user, user, 'places', { home: PLACES.home, away: null });
    assert.deepEqual((await columnsOf(user))?.places, { home: PLACES.home, away: null }, 'only one place is fine');
    await set(user, user, 'places', null);
    await set(user, user, 'week_questions', null);
    assert.deepEqual(await columnsOf(user), { places: null, week_questions: null });
  });

  test('the outline and the size are checked', async () => {
    const badPlaces: [string, unknown][] = [
      ['not an object', [PLACES.home]],
      ['no main city', { away: PLACES.away }],
      ['empty name', { home: { name: '  ', gear: {} } }],
      ['name too long', { home: { name: 'x'.repeat(61), gear: {} } }],
      ['gear as a list', { home: { name: 'Valencia', gear: ['pool'] } }],
      ['away without a name', { home: PLACES.home, away: { gear: {} } }],
      ['away as a string', { home: PLACES.home, away: 'Castellón' }],
    ];
    for (const [label, value] of badPlaces) {
      await assert.rejects(set(user, user, 'places', value), pgError({ code: '23514' }), label);
    }
    const badQuestions: [string, unknown][] = [
      ['not an object', [QUESTIONS]],
      ['enabled as a string', { enabled: 'sí', weeks: [] }],
      ['weeks as an object', { enabled: true, weeks: {} }],
      ['too many weeks', { enabled: true, weeks: Array.from({ length: 9 }, () => QUESTIONS.weeks[0]) }],
      ['too big', { enabled: true, weeks: [], notes: 'x'.repeat(9000) }],
    ];
    for (const [label, value] of badQuestions) {
      await assert.rejects(set(user, user, 'week_questions', value), pgError({ code: '23514' }), label);
    }
    await set(user, user, 'week_questions', { enabled: false });
    assert.deepEqual((await columnsOf(user))?.week_questions, { enabled: false }, 'missing weeks = none');
  });

  test('private: nobody else reads or changes them; only authenticated owners write them', async () => {
    await set(user, user, 'places', PLACES);
    const changed = await set(other, user, 'places', { home: { name: 'Madrid', gear: {} } });
    assert.equal(changed.length, 0, 'nobody else changes it');
    const seen = await t.asUser<{ places: unknown }>(other, 'select places from public.profiles where id = $1', [user]);
    assert.equal(seen.length, 0, 'nobody else reads it');
    assert.deepEqual((await columnsOf(user))?.places, PLACES);

    const [grants] = await t.admin<Record<string, boolean>>(
      `select has_column_privilege('authenticated', 'public.profiles', 'places', 'update') as places_update,
              has_column_privilege('authenticated', 'public.profiles', 'week_questions', 'update') as questions_update,
              has_column_privilege('anon', 'public.profiles', 'places', 'select') as anon_select,
              has_column_privilege('anon', 'public.profiles', 'week_questions', 'update') as anon_update`,
    );
    assert.deepEqual(grants, { places_update: true, questions_update: true, anon_select: false, anon_update: false });
  });
});
