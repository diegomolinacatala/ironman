/**
 * The hardening migrations (20261025000300 onward) applied on top of data written by the
 * earlier ones: stored joint participant names are dropped and old friend-request links fixed.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, migrationFiles, readSupabaseFile } from './harness.ts';
import type { TestDb } from './harness.ts';

const FIRST_HARDENING = '20261025000300';

async function applyMigrations(t: TestDb, filter: (name: string) => boolean): Promise<void> {
  for (const name of migrationFiles().filter(filter)) {
    await t.db.exec(readSupabaseFile(`migrations/${name}`));
  }
}

describe('upgrade from the initial migrations', () => {
  let t: TestDb;
  let organizer: string;
  let invitee: string;
  let viewer: string;
  let sessionId: string;

  before(async () => {
    t = await createTestDb({ migrate: false });
    await applyMigrations(t, (name) => name < FIRST_HARDENING);

    organizer = await t.createUser({ email: 'org@example.com', fullName: 'Organizer A' });
    invitee = await t.createUser({ email: 'inv@example.com', fullName: 'Private B' });
    viewer = await t.createUser({ email: 'viewer@example.com', fullName: 'Carla' });
    await t.admin(`update public.profiles set username = 'privateb', visibility = 'busy' where id = $1`, [invitee]);
    await t.admin(
      `insert into public.friendships (requester_id, addressee_id, status, responded_at)
       values ($1, $2, 'accepted', now()), ($1, $3, 'accepted', now())`,
      [organizer, invitee, viewer],
    );
    const [session] = await t.asUser<{ id: string }>(
      organizer,
      'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id',
      [JSON.stringify({ sport: 'run', date: isoDay(3), startTime: '19:00', durationMin: 60, title: 'Series' }), [invitee]],
    );
    sessionId = session?.id ?? '';
    await t.asUser(invitee, 'select public.respond_joint_session($1, true)', [sessionId]);
    await t.asUser(viewer, `select public.send_friend_request('privateb')`);

    await applyMigrations(t, (name) => name >= FIRST_HARDENING);
  });

  after(async () => {
    await t.close();
  });

  test('old joint_confirmed payloads lose the stored names and are masked at read time', async () => {
    const [stored] = await t.admin<{ payload: Record<string, unknown> }>(
      `select payload from public.activity_events where type = 'joint_confirmed' and payload ->> 'jointSessionId' = $1`,
      [sessionId],
    );
    assert.ok(stored);
    assert.ok(!('participants' in stored.payload));
    const feed = await t.asUser<{ type: string; payload: Record<string, unknown> }>(
      viewer,
      `select type, payload from public.list_feed() where type = 'joint_confirmed'`,
    );
    assert.deepEqual(feed.map((f) => [f.payload['participants'], f.payload['othersCount']]), [[['Organizer A'], 1]]);
  });

  test('friend requests already in the inbox now open Juntos', async () => {
    const notes = await t.asUser<{ data: { url: string } }>(
      invitee,
      `select data from public.notifications where type = 'friend_request'`,
    );
    assert.deepEqual(notes.map((n) => n.data.url), ['/together']);
  });
});
