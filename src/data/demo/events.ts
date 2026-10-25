/**
 * Demo equivalents of the database triggers: notifications and feed events.
 * Pure: each function returns a new DemoDb.
 */
import type { AppNotification, FeedEventType, NotificationType, Race, UUID, Workout } from '@/domain/types';

import { profileOf, type DemoClock, type DemoDb } from './db';

export function displayName(db: DemoDb, userId: UUID): string {
  return profileOf(db, userId)?.displayName ?? 'Alguien';
}

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  readAt?: string | null;
}

export function notify(db: DemoDb, userId: UUID, input: NotificationInput, clock: DemoClock): DemoDb {
  const notification: AppNotification = {
    id: clock.newId(),
    userId,
    type: input.type,
    title: input.title.slice(0, 120),
    body: (input.body ?? '').slice(0, 500),
    data: input.data ?? {},
    readAt: input.readAt ?? null,
    createdAt: input.createdAt ?? clock.now,
  };
  return { ...db, notifications: [notification, ...db.notifications] };
}

export function addFeedEvent(
  db: DemoDb,
  actorId: UUID,
  type: FeedEventType,
  payload: Record<string, unknown>,
  clock: DemoClock,
  createdAt?: string,
): DemoDb {
  const event = { id: clock.newId(), actorId, type, payload, createdAt: createdAt ?? clock.now };
  return { ...db, feed: [event, ...db.feed] };
}

/**
 * Feed event for a completed workout, mirroring the SQL trigger: skipped when
 * the actor's visibility is 'busy', title omitted when 'summary'.
 */
export function feedForCompletion(db: DemoDb, workout: Workout, clock: DemoClock, createdAt?: string): DemoDb {
  const visibility = profileOf(db, workout.userId)?.visibility ?? 'full';
  if (visibility === 'busy') return db;
  const distanceM = workout.completed?.distanceM ?? workout.distanceM;
  const payload: Record<string, unknown> = {
    workoutId: workout.id,
    sport: workout.sport,
    ...(visibility === 'full' ? { title: workout.title } : {}),
    date: workout.date,
    durationMin: Math.round(workout.completed?.durationMin ?? workout.durationMin),
    ...(distanceM != null ? { distanceM: Math.round(distanceM) } : {}),
    ...(workout.jointSessionId ? { jointSessionId: workout.jointSessionId } : {}),
  };
  return addFeedEvent(db, workout.userId, 'workout_completed', payload, clock, createdAt);
}

/** `race_added` feed event (skipped for 'busy' visibility, no name for 'summary'). */
export function feedForRace(db: DemoDb, race: Race, clock: DemoClock, createdAt?: string): DemoDb {
  const visibility = profileOf(db, race.userId)?.visibility ?? 'full';
  if (visibility === 'busy') return db;
  const payload = {
    raceId: race.id,
    ...(visibility === 'full' ? { name: race.name } : {}),
    date: race.date,
    distance: race.distance,
    priority: race.priority,
  };
  return addFeedEvent(db, race.userId, 'race_added', payload, clock, createdAt);
}
