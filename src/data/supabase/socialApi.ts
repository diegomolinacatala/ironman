import type {
  DateRange,
  FeedItem,
  Friend,
  FriendWeekItem,
  JointSession,
  JointSessionDraft,
  PublicProfile,
  UUID,
} from '@/domain/types';

import { RepositoryError, type Repository } from '../repository';
import { assertFriendRange, assertJointDraft } from '../demo/validation';
import { run, runVoid, type SupabaseCtx } from './base';
import { rowToPublicProfile } from './mappers';
import { rowToFeedItem, rowToFriend, rowToFriendWeekItem } from './mappersRpc';
import { asString } from './narrow';
import { parseJointSession, parseJointSessions } from './parsers';
import type { FeedRpcRow, FriendRpcRow, FriendWeekRpcRow, PublicProfileRpcRow } from './rows';

type SocialMethods = Pick<
  Repository,
  | 'searchProfiles'
  | 'listFriends'
  | 'sendFriendRequest'
  | 'respondFriendRequest'
  | 'removeFriend'
  | 'getFriendWeek'
  | 'listJointSessions'
  | 'getJointSession'
  | 'proposeJointSession'
  | 'respondJointSession'
  | 'cancelJointSession'
  | 'listFeed'
  | 'toggleKudos'
>;

/**
 * `p_session` jsonb for `propose_joint_session`. Sent with camelCase keys (as
 * the rest of the jsonb contracts) plus snake_case aliases, so the RPC can read
 * either convention.
 */
export function jointDraftToRpc(draft: JointSessionDraft): Record<string, unknown> {
  const startTime = draft.startTime ?? null;
  return {
    sport: draft.sport,
    date: draft.date,
    startTime,
    start_time: startTime,
    durationMin: Math.round(draft.durationMin),
    duration_min: Math.round(draft.durationMin),
    intensity: draft.intensity,
    title: draft.title.trim(),
    location: draft.location ?? null,
    notes: draft.notes ?? null,
  };
}

function friendsApi(
  ctx: SupabaseCtx,
): Pick<Repository, 'searchProfiles' | 'listFriends' | 'sendFriendRequest' | 'respondFriendRequest' | 'removeFriend' | 'getFriendWeek'> {
  const { client } = ctx;
  return {
    async searchProfiles(query: string): Promise<PublicProfile[]> {
      const q = query.trim();
      if (q.length < 2) return [];
      const rows = await run<PublicProfileRpcRow[] | null>('searchProfiles', client.rpc('search_profiles', { p_query: q }));
      return (rows ?? []).map(rowToPublicProfile);
    },
    async listFriends(): Promise<Friend[]> {
      const rows = await run<FriendRpcRow[] | null>('listFriends', client.rpc('list_friends'));
      return (rows ?? []).map(rowToFriend);
    },
    async sendFriendRequest(username: string): Promise<void> {
      const clean = username.trim().replace(/^@/, '').toLowerCase();
      if (clean.length < 3) throw new RepositoryError('validation', 'Escribe el usuario de tu amigo.');
      await runVoid('sendFriendRequest', client.rpc('send_friend_request', { p_username: clean }));
    },
    async respondFriendRequest(friendshipId: UUID, accept: boolean): Promise<void> {
      await runVoid(
        'respondFriendRequest',
        client.rpc('respond_friend_request', { p_friendship_id: friendshipId, p_accept: accept }),
      );
    },
    async removeFriend(friendshipId: UUID): Promise<void> {
      await runVoid('removeFriend', client.from('friendships').delete().eq('id', friendshipId));
    },
    async getFriendWeek(friendId: UUID, range: DateRange): Promise<FriendWeekItem[]> {
      assertFriendRange(range);
      const rows = await run<FriendWeekRpcRow[] | null>(
        'getFriendWeek',
        client.rpc('get_friend_week', { p_friend: friendId, p_from: range.from, p_to: range.to }),
      );
      return (rows ?? []).map(rowToFriendWeekItem);
    },
  };
}

function jointApi(
  ctx: SupabaseCtx,
): Pick<Repository, 'listJointSessions' | 'getJointSession' | 'proposeJointSession' | 'respondJointSession' | 'cancelJointSession'> {
  const { client } = ctx;

  async function listJointSessions(range: DateRange): Promise<JointSession[]> {
    const data = await run<unknown>(
      'listJointSessions',
      client.rpc('list_joint_sessions', { p_from: range.from, p_to: range.to }),
    );
    return parseJointSessions(data);
  }

  async function getJointSession(id: UUID): Promise<JointSession | null> {
    // `get_joint_session` (db migration 0240) returns the camelCase JSON or null.
    const data = await run<unknown>('getJointSession', client.rpc('get_joint_session', { p_session_id: id }));
    return parseJointSession(data);
  }

  async function proposeJointSession(draft: JointSessionDraft): Promise<JointSession> {
    assertJointDraft(draft);
    const id = asString(
      await run<unknown>(
        'proposeJointSession',
        client.rpc('propose_joint_session', {
          p_session: jointDraftToRpc(draft),
          p_invitees: draft.inviteeIds,
          p_from_workout: draft.fromWorkoutId ?? null,
        }),
        'No se ha podido crear la quedada.',
      ),
    );
    if (!id) throw new RepositoryError('unknown', 'No se ha podido crear la quedada.');
    const created = await getJointSession(id);
    if (!created) throw new RepositoryError('not_found', 'La quedada se ha creado pero no podemos leerla. Recarga.');
    return created;
  }

  return {
    listJointSessions,
    getJointSession,
    proposeJointSession,
    async respondJointSession(id: UUID, accept: boolean): Promise<void> {
      await runVoid('respondJointSession', client.rpc('respond_joint_session', { p_session_id: id, p_accept: accept }));
    },
    async cancelJointSession(id: UUID): Promise<void> {
      await runVoid('cancelJointSession', client.rpc('cancel_joint_session', { p_session_id: id }));
    },
  };
}

function feedApi(ctx: SupabaseCtx): Pick<Repository, 'listFeed' | 'toggleKudos'> {
  const { client } = ctx;
  return {
    async listFeed(limit = 30): Promise<FeedItem[]> {
      const rows = await run<FeedRpcRow[] | null>('listFeed', client.rpc('list_feed', { p_limit: limit }));
      return (rows ?? []).map(rowToFeedItem);
    },
    async toggleKudos(feedItemId: UUID): Promise<void> {
      await runVoid('toggleKudos', client.rpc('toggle_kudos', { p_event_id: feedItemId }));
    },
  };
}

export function socialApi(ctx: SupabaseCtx): SocialMethods {
  return { ...friendsApi(ctx), ...jointApi(ctx), ...feedApi(ctx) };
}
