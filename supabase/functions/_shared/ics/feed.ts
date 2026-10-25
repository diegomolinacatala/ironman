/**
 * Calendar feed content: the athlete's workouts (−14…+56 days) plus confirmed
 * quedadas without a linked workout. UIDs are stable per workout/session so
 * calendar apps update events in place.
 */
import { formatDistance, formatDuration, intensityLabel, sportLabel } from '../planning/labels.ts';
import type { JointSession, UUID, Workout } from '../types.ts';
import { buildCalendar } from './format.ts';
import type { IcsEvent } from './format.ts';

export const ICS_PAST_DAYS = 14;
export const ICS_FUTURE_DAYS = 56;
const UID_DOMAIN = 'rebufo.app';

function partnerNames(session: JointSession | undefined, userId: UUID): string[] {
  if (!session) return [];
  return session.participants.filter((p) => p.userId !== userId && p.status !== 'declined').map((p) => p.displayName);
}

function workoutDescription(w: Workout, partners: readonly string[]): string {
  const c = w.completed;
  return [
    `${sportLabel(w.sport)} · ${formatDuration(w.durationMin)} · ${intensityLabel(w.intensity)}`,
    w.distanceM ? `Distancia: ${formatDistance(w.distanceM, w.sport)}` : null,
    w.isKey ? 'Sesión clave de la semana' : null,
    partners.length ? `Quedada con ${partners.join(', ')}` : null,
    w.description,
    w.status === 'completed' && c
      ? `Hecho: ${formatDuration(c.durationMin ?? w.durationMin)}${c.avgHr ? ` · FC media ${c.avgHr}` : ''}${c.rpe ? ` · RPE ${c.rpe}` : ''}`
      : null,
    'Plan de Rebufo',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function safeStamp(value: string, fallback: Date): Date {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function workoutEvent(w: Workout, sessions: readonly JointSession[], userId: UUID, now: Date): IcsEvent {
  const session = w.jointSessionId ? sessions.find((s) => s.id === w.jointSessionId) : undefined;
  const partners = partnerNames(session, userId);
  const done = w.status === 'completed';
  const summary = `${done ? '✓ ' : ''}${w.title} (${sportLabel(w.sport)})${partners.length ? ` · con ${partners.join(', ')}` : ''}`;
  return {
    uid: `workout-${w.id}@${UID_DOMAIN}`,
    stamp: safeStamp(w.updatedAt || w.createdAt, now),
    summary,
    description: workoutDescription(w, partners),
    date: w.date,
    startTime: w.startTime,
    durationMin: done ? (w.completed?.durationMin ?? w.durationMin) : w.durationMin,
    categories: [sportLabel(w.sport), ...(partners.length ? ['Quedada'] : [])],
    location: session?.location ?? null,
    status: session && session.status === 'proposed' ? 'TENTATIVE' : 'CONFIRMED',
  };
}

export function jointEvent(s: JointSession, userId: UUID, stamp: Date): IcsEvent {
  const partners = partnerNames(s, userId);
  return {
    uid: `joint-${s.id}@${UID_DOMAIN}`,
    stamp,
    summary: `${s.title} (${sportLabel(s.sport)})${partners.length ? ` · con ${partners.join(', ')}` : ''}`,
    description: [`Quedada · ${formatDuration(s.durationMin)} · ${intensityLabel(s.intensity)}`, 'Plan de Rebufo'].join('\n'),
    date: s.date,
    startTime: s.startTime,
    durationMin: s.durationMin,
    categories: [sportLabel(s.sport), 'Quedada'],
    location: s.location,
    status: 'CONFIRMED',
  };
}

export interface FeedInput {
  userId: UUID;
  workouts: readonly Workout[];
  jointSessions: readonly JointSession[];
  now: Date;
  calendarName?: string;
}

export function buildIcsFeed(input: FeedInput): string {
  const visible = input.workouts.filter((w) => w.status !== 'skipped' && w.sport !== 'rest');
  const linked = new Set(visible.map((w) => w.jointSessionId).filter((id): id is string => Boolean(id)));
  const extraJoint = input.jointSessions.filter((s) => {
    if (s.status !== 'confirmed' || linked.has(s.id)) return false;
    const me = s.participants.find((p) => p.userId === input.userId);
    return s.organizerId === input.userId || me?.status === 'accepted';
  });
  const events = [
    ...visible.map((w) => workoutEvent(w, input.jointSessions, input.userId, input.now)),
    ...extraJoint.map((s) => jointEvent(s, input.userId, input.now)),
  ].sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  return buildCalendar(events, input.calendarName ?? 'Rebufo');
}
