/**
 * Mappers for RPC result rows (ARCHITECTURE §7). Pure.
 */
import {
  INTENSITIES,
  SPORTS,
  type CreatedToken,
  type FeedItem,
  type Friend,
  type FriendWeekItem,
  type IntegrationStatus,
  type PersonalToken,
  type SyncResult,
  type TokenScope,
} from '@/domain/types';

import { asNumber, asString, isRecord, oneOf, oneOfOr, pick, timeFromDb } from './narrow';
import { rowToPublicProfile } from './mappers';
import type { FeedRpcRow, FriendRpcRow, FriendWeekRpcRow, IntegrationRpcRow, TokenRpcRow } from './rows';

const FRIENDSHIP_STATUSES = ['pending', 'accepted', 'declined', 'blocked'] as const;
const DIRECTIONS = ['incoming', 'outgoing', 'mutual'] as const;
const WEEK_ITEM_KINDS = ['workout', 'busy', 'event'] as const;
const WORKOUT_STATUSES = ['planned', 'completed', 'skipped'] as const;
const FEED_TYPES = ['workout_completed', 'race_added', 'joint_confirmed', 'plan_updated'] as const;
const TOKEN_SCOPES: readonly TokenScope[] = ['mcp', 'ics'];
const INTEGRATION_STATES = ['connected', 'error', 'expired', 'disconnected'] as const;
const VISIBILITIES = ['full', 'summary', 'busy'] as const;

export function rowToFriend(row: FriendRpcRow): Friend {
  const status = oneOfOr(row.status, FRIENDSHIP_STATUSES, 'pending');
  const direction = status === 'accepted' ? 'mutual' : oneOfOr(row.direction, DIRECTIONS, 'outgoing');
  return {
    friendshipId: row.friendship_id,
    status,
    direction,
    visibility: status === 'accepted' && row.visibility ? oneOfOr(row.visibility, VISIBILITIES, 'busy') : null,
    createdAt: row.created_at,
    profile: rowToPublicProfile({
      id: row.friend_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      sports: row.sports,
    }),
  };
}

export function rowToFriendWeekItem(row: FriendWeekRpcRow): FriendWeekItem {
  return {
    kind: oneOfOr(row.kind, WEEK_ITEM_KINDS, 'busy'),
    id: row.id,
    date: row.date,
    startTime: timeFromDb(row.start_time),
    endTime: timeFromDb(row.end_time),
    durationMin: asNumber(row.duration_min),
    sport: oneOf(row.sport, SPORTS),
    intensity: oneOf(row.intensity, INTENSITIES),
    title: row.title,
    status: oneOf(row.status, WORKOUT_STATUSES),
    jointSessionId: row.joint_session_id,
  };
}

export function rowToFeedItem(row: FeedRpcRow): FeedItem {
  return {
    id: row.id,
    actor: rowToPublicProfile({
      id: row.actor_id,
      username: row.actor_username,
      display_name: row.actor_display_name,
      avatar_url: row.actor_avatar_url,
      sports: row.actor_sports,
    }),
    type: oneOfOr(row.type, FEED_TYPES, 'plan_updated'),
    payload: isRecord(row.payload) ? row.payload : {},
    createdAt: row.created_at,
    kudosCount: asNumber(row.kudos_count) ?? 0,
    hasKudoed: row.has_kudoed === true,
  };
}

export function rowToToken(row: TokenRpcRow): PersonalToken {
  return {
    id: row.id,
    scope: oneOfOr(row.scope, TOKEN_SCOPES, 'mcp'),
    label: row.label ?? '',
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export function rowToIntegration(row: IntegrationRpcRow): IntegrationStatus {
  return {
    provider: 'garmin_personal',
    state: oneOfOr(row.state, INTEGRATION_STATES, 'disconnected'),
    expiresAt: row.key_expires_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
  };
}

/** Connector URLs built from the edge-functions base URL. */
export function tokenUrl(scope: TokenScope, secret: string, functionsBaseUrl: string): string {
  const base = functionsBaseUrl.replace(/\/$/, '');
  return scope === 'mcp' ? `${base}/mcp/u/${secret}` : `${base}/ics/${secret}.ics`;
}

/** `create_personal_token` → `{ id, secret, prefix }` (jsonb). */
export function parseCreatedToken(
  value: unknown,
  input: { scope: TokenScope; label: string; now: string; functionsBaseUrl: string },
): CreatedToken | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const secret = asString(value.secret);
  if (!id || !secret) return null;
  const prefix = asString(value.prefix) ?? secret.slice(0, 10);
  return {
    secret,
    url: tokenUrl(input.scope, secret, input.functionsBaseUrl),
    token: {
      id,
      scope: input.scope,
      label: input.label,
      prefix,
      createdAt: asString(pick(value, 'createdAt', 'created_at')) ?? input.now,
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

/** Garmin edge function `sync` response (camelCase, snake_case tolerated). */
export function parseSyncResult(value: unknown): SyncResult {
  const record = isRecord(value) ? value : {};
  const metricsDays = asNumber(pick(record, 'metricsDays', 'metrics_days')) ?? 0;
  const activitiesImported = asNumber(pick(record, 'activitiesImported', 'activities_imported')) ?? 0;
  const workoutsCompleted = asNumber(pick(record, 'workoutsCompleted', 'workouts_completed')) ?? 0;
  const message =
    asString(record.message) ??
    `Sincronizado: ${metricsDays} días de métricas, ${workoutsCompleted} entrenos completados y ${activitiesImported} actividades nuevas.`;
  return { metricsDays, activitiesImported, workoutsCompleted, message };
}
