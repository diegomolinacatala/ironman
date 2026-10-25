/**
 * Realtime bridge: one channel per subscription with `postgres_changes`
 * bindings filtered to the current user, mapped to `ChangeTopic`s.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

import type { ChangeTopic } from '../repository';
import type { SupabaseCtx } from './base';
import { asString, isRecord } from './narrow';

/** Tables filtered by `user_id=eq.<me>` and the topic each one invalidates. */
export const OWN_TABLE_TOPICS: Readonly<Record<string, ChangeTopic>> = {
  workouts: 'workouts',
  notifications: 'notifications',
  plan_proposals: 'proposals',
  coach_jobs: 'proposals',
  joint_session_participants: 'joint_sessions',
  races: 'races',
  life_events: 'life_events',
  daily_metrics: 'metrics',
};

/** Extra topics implied by a new notification (e.g. a friend answered a quedada). */
export function topicsForNotificationType(type: string | null): ChangeTopic[] {
  if (!type) return [];
  if (type.startsWith('joint_')) return ['joint_sessions', 'workouts'];
  if (type === 'friend_request' || type === 'friend_accepted') return ['friends'];
  if (type === 'plan_updated') return ['proposals'];
  if (type === 'kudos' || type === 'friend_completed') return ['feed'];
  return [];
}

/** Topics to emit for a realtime payload of `table`. Pure. */
export function topicsForChange(table: string, payload: unknown): ChangeTopic[] {
  if (table === 'friendships') return ['friends', 'feed'];
  const base = OWN_TABLE_TOPICS[table];
  if (!base) return [];
  if (table !== 'notifications') return [base];
  const record = isRecord(payload) && isRecord(payload.new) ? payload.new : null;
  return [base, ...topicsForNotificationType(record ? asString(record.type) : null)];
}

export function subscribeRealtime(ctx: SupabaseCtx, onChange: (topic: ChangeTopic) => void): () => void {
  let channel: RealtimeChannel | null = null;
  let closed = false;

  const emit = (table: string, payload: unknown): void => {
    const topics = [...new Set(topicsForChange(table, payload))];
    topics.forEach((topic) => onChange(topic));
  };

  ctx
    .userId()
    .then((me) => {
      if (closed) return;
      const next = ctx.client.channel(`rebufo:${me}:${Date.now().toString(36)}`);
      Object.keys(OWN_TABLE_TOPICS).forEach((table) => {
        next.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${me}` }, (payload) =>
          emit(table, payload),
        );
      });
      ['requester_id', 'addressee_id'].forEach((column) => {
        next.on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `${column}=eq.${me}` }, (payload) =>
          emit('friendships', payload),
        );
      });
      next.subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') logger.warn(`realtime ${status}`, error?.message);
      });
      channel = next;
    })
    .catch((error: unknown) => logger.warn('realtime subscribe skipped', error));

  return () => {
    closed = true;
    if (channel) {
      const current = channel;
      channel = null;
      ctx.client.removeChannel(current).catch((error: unknown) => logger.warn('realtime unsubscribe failed', error));
    }
  };
}
