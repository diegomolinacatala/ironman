/**
 * "Tu informe de hoy" when you wake up (20261126000300_wake_notification.sql): who the sweep looks
 * at, the light-pull throttle, one briefing per user and local day whoever sends it (server push
 * or the app's Apple Salud claim), and the privileges.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface Candidate {
  user_id: string;
  timezone: string;
  local_date: string;
  local_minutes: number;
  prefs: Record<string, unknown>;
  garmin: boolean;
  last_check_at: string | null;
  nights: { date: string; source: string; start: string | null; end: string | null }[];
}

/** 06:00 UTC = 07:00 in Madrid (winter). */
const MORNING = '2026-11-26T06:00:00Z';
const WAKE_PREFS = { morningSummary: true, morningTime: '07:30', morningMode: 'wake', wakeDelayMin: 15 };

describe('wake-up briefing (briefing_notices + RPCs)', () => {
  let t: TestDb;
  let wake: string;
  let fixed: string;
  let off: string;
  let other: string;

  const setPrefs = (user: string, prefs: Record<string, unknown>) =>
    t.admin(`update public.profiles set notification_prefs = $2::jsonb, timezone = 'Europe/Madrid' where id = $1`, [user, JSON.stringify(prefs)]);

  // local_date as text: PostgREST sends dates as 'YYYY-MM-DD' (PGlite would give a Date).
  const candidates = (now = MORNING) =>
    t.asService<Candidate>(
      `select user_id, timezone, local_date::text as local_date, local_minutes, prefs, garmin, last_check_at, nights
       from public.svc_wake_candidates($1::timestamptz)`,
      [now],
    );

  const send = (user: string, date: string, reason = 'wake') =>
    t.asService<{ sent: boolean }>(
      `select public.svc_send_morning_briefing($1, $2::date, $3, now() - interval '20 minutes', now() - interval '5 minutes') as sent`,
      [user, date, reason],
    );

  const notifications = (user: string) =>
    t.admin<{ type: string; title: string; data: Record<string, unknown>; read_at: string | null }>(
      `select type, title, data, read_at from public.notifications where user_id = $1 and type = 'morning_briefing'`,
      [user],
    );

  const localToday = async (): Promise<string> => {
    const [row] = await t.admin<{ d: string }>(`select ((now() at time zone 'Europe/Madrid')::date)::text as d`);
    return row?.d ?? '';
  };

  before(async () => {
    t = await createTestDb();
    wake = await t.createUser({ email: 'wake-a@example.com' });
    fixed = await t.createUser({ email: 'wake-fixed@example.com' });
    off = await t.createUser({ email: 'wake-off@example.com' });
    other = await t.createUser({ email: 'wake-other@example.com' });
  });

  beforeEach(async () => {
    await t.admin(`delete from public.briefing_notices`);
    await t.admin(`delete from public.notifications`);
    await t.admin(`delete from public.daily_metrics`);
    await t.admin(`delete from public.integration_credentials`);
    await setPrefs(wake, WAKE_PREFS);
    await setPrefs(fixed, { ...WAKE_PREFS, morningMode: 'fixed' });
    await setPrefs(off, { ...WAKE_PREFS, morningSummary: false });
    await setPrefs(other, WAKE_PREFS);
  });

  after(async () => {
    await t.close();
  });

  test('candidates: wake mode with the briefing on, from 03:00 local, with local time and nights', async () => {
    await t.admin(
      `insert into public.daily_metrics (user_id, date, source, sleep_hours, sleep_start, sleep_end) values
         ($1, '2026-11-25', 'garmin', 7.5, '2026-11-24T22:40:00Z', '2026-11-25T06:05:00Z'),
         ($1, '2026-11-25', 'healthkit', 7.4, '2026-11-24T22:45:00Z', '2026-11-25T06:02:00Z'),
         ($1, '2026-10-30', 'garmin', 7, '2026-10-29T22:00:00Z', '2026-10-30T06:00:00Z'),
         ($1, '2026-11-24', 'garmin', 6.8, null, null)`,
      [wake],
    );
    const rows = await candidates();
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [wake, other].sort());
    const mine = rows.find((r) => r.user_id === wake);
    assert.equal(mine?.timezone, 'Europe/Madrid');
    assert.equal(mine?.local_date, '2026-11-26');
    assert.equal(mine?.local_minutes, 7 * 60);
    assert.equal(mine?.garmin, false);
    assert.equal(mine?.last_check_at, null);
    // Last 22 days only, nights with a start or an end, every source.
    assert.deepEqual(
      mine?.nights.map((n) => [n.date, n.source]),
      [
        ['2026-11-25', 'garmin'],
        ['2026-11-25', 'healthkit'],
      ],
    );
    assert.deepEqual(await candidates('2026-11-26T01:30:00Z'), [], 'nobody before 03:00 local');
  });

  test('candidates know whether Garmin is connected', async () => {
    await t.admin(
      `insert into public.integration_credentials (user_id, provider, secret_ciphertext, state) values ($1, 'garmin_personal', 'x', 'connected')`,
      [wake],
    );
    const mine = (await candidates()).find((r) => r.user_id === wake);
    assert.equal(mine?.garmin, true);
  });

  test('light pulls are counted per local day and shown to the next sweep', async () => {
    await t.asService(`select public.svc_record_wake_check($1, '2026-11-26')`, [wake]);
    await t.asService(`select public.svc_record_wake_check($1, '2026-11-26')`, [wake]);
    const [row] = await t.admin<{ status: string; checks: number; done_at: string | null }>(
      `select status, checks, done_at from public.briefing_notices where user_id = $1`,
      [wake],
    );
    assert.deepEqual(row, { status: 'watching', checks: 2, done_at: null });
    const mine = (await candidates()).find((r) => r.user_id === wake);
    assert.ok(mine?.last_check_at, 'still a candidate, with its last pull');
  });

  test('one briefing per user and local day: pushed once, already read, then off the list', async () => {
    assert.deepEqual(await send(wake, '2026-11-26'), [{ sent: true }]);
    assert.deepEqual(await send(wake, '2026-11-26', 'fallback'), [{ sent: false }]);
    const sent = await notifications(wake);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.title, 'Tu informe de hoy');
    assert.equal(sent[0]?.data.url, '/briefing?play=1');
    assert.equal(sent[0]?.data.reason, 'wake');
    assert.ok(sent[0]?.read_at, 'no unread badge every morning');
    const [row] = await t.admin<{ status: string; reason: string }>(`select status, reason from public.briefing_notices where user_id = $1`, [wake]);
    assert.deepEqual(row, { status: 'push', reason: 'wake' });
    assert.ok(!(await candidates()).some((r) => r.user_id === wake));
    // Another day is a new briefing.
    assert.deepEqual(await send(wake, '2026-11-27'), [{ sent: true }]);
  });

  test('too late: the day is settled without a notification', async () => {
    const [row] = await t.asService<{ skipped: boolean }>(`select public.svc_skip_morning_briefing($1, '2026-11-26') as skipped`, [wake]);
    assert.equal(row?.skipped, true);
    assert.deepEqual(await send(wake, '2026-11-26'), [{ sent: false }]);
    assert.deepEqual(await notifications(wake), []);
    assert.ok(!(await candidates()).some((r) => r.user_id === wake));
  });

  test('the app claims today from Apple Salud: the server never pushes a second one', async () => {
    const today = await localToday();
    const claim = () =>
      t.asUser<{ claimed: boolean }>(
        wake,
        `select public.claim_wake_briefing($1::date, now() - interval '20 minutes', now() - interval '5 minutes') as claimed`,
        [today],
      );
    assert.deepEqual(await claim(), [{ claimed: true }]);
    assert.deepEqual(await claim(), [{ claimed: false }]);
    assert.deepEqual(await send(wake, today), [{ sent: false }]);
    assert.deepEqual(await notifications(wake), []);
    const [row] = await t.asUser<{ status: string }>(wake, `select status from public.briefing_notices`);
    assert.equal(row?.status, 'device');
  });

  test('the server pushed first: the app does not claim', async () => {
    const today = await localToday();
    await send(wake, today);
    const [row] = await t.asUser<{ claimed: boolean }>(
      wake,
      `select public.claim_wake_briefing($1::date, now() - interval '20 minutes', now() - interval '5 minutes') as claimed`,
      [today],
    );
    assert.equal(row?.claimed, false);
  });

  test('claims are checked: only today, a recent wake-up, a due time within the hour, wake mode', async () => {
    const today = await localToday();
    const claim = (user: string, date: string, sleepEnd: string, dueAt: string) =>
      t.asUser(user, `select public.claim_wake_briefing($1::date, ${sleepEnd}, ${dueAt}) as claimed`, [date]);
    await assert.rejects(
      claim(wake, '2020-01-01', `now() - interval '20 minutes'`, `now()`),
      pgError({ code: '22023', hint: 'validation' }),
    );
    await assert.rejects(claim(wake, today, `now() - interval '20 hours'`, `now() - interval '19 hours'`), pgError({ code: '22023' }));
    await assert.rejects(claim(wake, today, `now() - interval '20 minutes'`, `now() - interval '30 minutes'`), pgError({ code: '22023' }));
    await assert.rejects(claim(wake, today, `now() - interval '20 minutes'`, `now() + interval '2 hours'`), pgError({ code: '22023' }));
    const [notWake] = await claim(fixed, today, `now() - interval '20 minutes'`, `now()`);
    assert.equal((notWake as { claimed: boolean }).claimed, false);
  });

  test('privileges: own rows only, no direct writes, service functions closed to the app', async () => {
    await send(wake, '2026-11-26');
    assert.equal((await t.asUser(wake, `select * from public.briefing_notices`)).length, 1);
    assert.equal((await t.asUser(other, `select * from public.briefing_notices`)).length, 0);
    await assert.rejects(
      t.asUser(other, `insert into public.briefing_notices (user_id, date) values ($1, '2026-11-26')`, [other]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(t.asUser(wake, `select public.svc_wake_candidates()`), pgError({ code: '42501' }));
    await assert.rejects(t.asUser(wake, `select public.svc_send_morning_briefing($1, '2026-11-26', 'wake', null, now())`, [wake]), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon(`select public.claim_wake_briefing(current_date, now(), now())`), pgError({ code: '42501' }));
  });
});
