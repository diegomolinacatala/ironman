import type {
  DateRange,
  FeedItem,
  Friend,
  FriendRace,
  JointComment,
  JointSessionPatch,
  FriendWeekItem,
  JointSession,
  JointSessionDraft,
  PublicProfile,
  UserReportDraft,
  UUID,
} from '@/domain/types';

import { RepositoryError, type Repository } from '../repository';
import { assertFriendRange, assertJointDraft, assertReport } from '../demo/validation';
import { run, runVoid, type SupabaseCtx } from './base';
import { rowToPublicProfile } from './mappers';
import { rowToFeedItem, rowToFriend, rowToFriendWeekItem } from './mappersRpc';
import { asString } from './narrow';
import { parseFriendRaces, parseJointComment, parseJointComments, parseJointSession, parseJointSessions } from './parsers';
import type { FeedRpcRow, FriendRpcRow, FriendWeekRpcRow, PublicProfileRpcRow } from './rows';

type SocialMethods = Pick<
  Repository,
  | 'searchProfiles'
  | 'listFriends'
  | 'sendFriendRequest'
  | 'respondFriendRequest'
  | 'removeFriend'
  | 'blockUser'
  | 'reportUser'
  | 'getFriendWeek'
  | 'listJointSessions'
  | 'getJointSession'
  | 'proposeJointSession'
  | 'respondJointSession'
  | 'cancelJointSession'
  | 'updateJointSession'
  | 'listOpenJointSessions'
  | 'joinJointSession'
  | 'listJointComments'
  | 'addJointComment'
  | 'listFriendRaces'
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
    isOpen: draft.isOpen === true,
  };
}

/** `p_patch` jsonb for `update_joint_session`: only the given fields (camelCase). */
export function jointPatchToRpc(patch: JointSessionPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.sport !== undefined) out.sport = patch.sport;
  if (patch.date !== undefined) out.date = patch.date;
  if (patch.startTime !== undefined) out.startTime = patch.startTime;
  if (patch.durationMin !== undefined) out.durationMin = Math.round(patch.durationMin);
  if (patch.intensity !== undefined) out.intensity = patch.intensity;
  if (patch.title !== undefined) out.title = patch.title.trim();
  if (patch.location !== undefined) out.location = patch.location?.trim() || null;
  if (patch.notes !== undefined) out.notes = patch.notes?.trim() || null;
  if (patch.isOpen !== undefined) out.isOpen = patch.isOpen;
  return out;
}

function friendsApi(
  ctx: SupabaseCtx,
): Pick<Repository, 'searchProfiles' | 'listFriends' | 'sendFriendRequest' | 'respondFriendRequest' | 'removeFriend' | 'blockUser' | 'reportUser' | 'getFriendWeek'> {
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
    async blockUser(userId: UUID): Promise<void> {
      await runVoid('blockUser', client.rpc('block_user', { p_user: userId }), 'No se ha podido bloquear.');
    },
    async reportUser(report: UserReportDraft): Promise<void> {
      const draft = assertReport(report);
      await runVoid(
        'reportUser',
        client.rpc('report_user', {
          p_user: draft.userId,
          p_reason: draft.reason,
          p_context: draft.context,
          p_target: draft.targetId ?? null,
          p_details: draft.details ?? null,
        }),
        'No se ha podido enviar la denuncia.',
      );
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

export const MAX_COMMENT_LENGTH = 500;

function sessionOrThrow(value: unknown, fallback: string): JointSession {
  const session = parseJointSession(value);
  if (!session) throw new RepositoryError('unknown', fallback);
  return session;
}

type TogetherMethods = Pick<
  Repository,
  'updateJointSession' | 'listOpenJointSessions' | 'joinJointSession' | 'listJointComments' | 'addJointComment' | 'listFriendRaces'
>;

/** Open quedadas, edits, comments and friends' races (db migration 20261104000100). */
function togetherApi(ctx: SupabaseCtx): TogetherMethods {
  const { client } = ctx;
  return {
    async updateJointSession(id: UUID, patch: JointSessionPatch): Promise<JointSession> {
      const body = jointPatchToRpc(patch);
      if (Object.keys(body).length === 0) throw new RepositoryError('validation', 'No hay cambios que guardar.');
      const data = await run<unknown>(
        'updateJointSession',
        client.rpc('update_joint_session', { p_session_id: id, p_patch: body }),
        'No se ha podido cambiar la quedada.',
      );
      return sessionOrThrow(data, 'No se ha podido cambiar la quedada.');
    },
    async listOpenJointSessions(range: DateRange): Promise<JointSession[]> {
      const data = await run<unknown>(
        'listOpenJointSessions',
        client.rpc('list_open_joint_sessions', { p_from: range.from, p_to: range.to }),
      );
      return parseJointSessions(data);
    },
    async joinJointSession(id: UUID): Promise<JointSession> {
      const data = await run<unknown>('joinJointSession', client.rpc('join_joint_session', { p_session_id: id }), 'No te has podido apuntar.');
      return sessionOrThrow(data, 'No te has podido apuntar.');
    },
    async listJointComments(sessionId: UUID): Promise<JointComment[]> {
      const data = await run<unknown>('listJointComments', client.rpc('list_joint_comments', { p_session_id: sessionId }));
      return parseJointComments(data);
    },
    async addJointComment(sessionId: UUID, body: string): Promise<JointComment> {
      const text = body.trim();
      if (!text) throw new RepositoryError('validation', 'Escribe un mensaje.');
      if (text.length > MAX_COMMENT_LENGTH) throw new RepositoryError('validation', 'Mensaje demasiado largo (máximo 500 caracteres).');
      const data = await run<unknown>(
        'addJointComment',
        client.rpc('add_joint_comment', { p_session_id: sessionId, p_body: text }),
        'No se ha podido enviar el mensaje.',
      );
      const comment = parseJointComment(data);
      if (!comment) throw new RepositoryError('unknown', 'No se ha podido enviar el mensaje.');
      return comment;
    },
    async listFriendRaces(): Promise<FriendRace[]> {
      return parseFriendRaces(await run<unknown>('listFriendRaces', client.rpc('list_friend_races')));
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
  return { ...friendsApi(ctx), ...jointApi(ctx), ...togetherApi(ctx), ...feedApi(ctx) };
}
