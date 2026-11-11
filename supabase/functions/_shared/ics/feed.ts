/**
 * Calendar feed content: the athlete's workouts (−14…+56 days) plus confirmed
 * quedadas without a linked workout. UIDs are stable per workout/session so
 * calendar apps update events in place. v4: each workout's notes carry the
 * coach's prescription (mirrored prescriptionText: objective, structure with
 * the athlete's numbers, keys, success criterion and plan B).
 */
import { prescriptionText } from '../planning/domain/prescription.ts';
import { formatDistance, formatDuration, intensityLabel, sportLabel } from '../planning/labels.ts';
import type { JointSession, RaceDistance, Thresholds, UUID, Workout } from '../types.ts';
import { buildCalendar } from './format.ts';
import type { IcsEvent } from './format.ts';

export const ICS_PAST_DAYS = 14;
export const ICS_FUTURE_DAYS = 56;
const UID_DOMAIN = 'roadtoironman.app';
/** Calendar apps show long notes, but keep each event reasonable (the prescription is ~300–900 chars). */
const NOTES_MAX = 1000;
const PRESCRIPTION_MAX = 2000;

/** What the prescription needs: the athlete's thresholds and the target race distance. */
export interface PrescriptionOptions {
  thresholds?: Thresholds | null;
  raceDistance?: RaceDistance | null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function prescriptionOf(w: Workout, opts: PrescriptionOptions): string | null {
  if (w.sport === 'rest') return null;
  const text = prescriptionText(w, opts.thresholds ?? null, { raceDistance: opts.raceDistance ?? null }).trim();
  return text ? clip(text, PRESCRIPTION_MAX) : null;
}

function partnerNames(session: JointSession | undefined, userId: UUID): string[] {
  if (!session) return [];
  return session.participants.filter((p) => p.userId !== userId && p.status !== 'declined').map((p) => p.displayName);
}

function workoutDescription(w: Workout, partners: readonly string[], opts: PrescriptionOptions): string {
  const c = w.completed;
  return [
    `${sportLabel(w.sport)} · ${formatDuration(w.durationMin)} · ${intensityLabel(w.intensity)}`,
    w.distanceM ? `Distancia: ${formatDistance(w.distanceM, w.sport)}` : null,
    w.isKey ? 'Sesión clave de la semana' : null,
    partners.length ? `Quedada con ${partners.join(', ')}` : null,
    w.description ? clip(w.description, NOTES_MAX) : null,
    prescriptionOf(w, opts),
    w.status === 'completed' && c
      ? `Hecho: ${formatDuration(c.durationMin ?? w.durationMin)}${c.avgHr ? ` · FC media ${c.avgHr} ppm` : ''}${c.rpe ? ` · RPE ${c.rpe}` : ''}${c.feel ? ` · sensaciones ${c.feel}/5` : ''}`
      : null,
    'Plan de Road to Ironman',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function safeStamp(value: string, fallback: Date): Date {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function workoutEvent(w: Workout, sessions: readonly JointSession[], userId: UUID, now: Date, opts: PrescriptionOptions = {}): IcsEvent {
  const session = w.jointSessionId ? sessions.find((s) => s.id === w.jointSessionId) : undefined;
  const partners = partnerNames(session, userId);
  const done = w.status === 'completed';
  const summary = `${done ? '✓ ' : ''}${w.title} (${sportLabel(w.sport)})${partners.length ? ` · con ${partners.join(', ')}` : ''}`;
  return {
    uid: `workout-${w.id}@${UID_DOMAIN}`,
    stamp: safeStamp(w.updatedAt || w.createdAt, now),
    summary,
    description: workoutDescription(w, partners, opts),
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
    description: [`Quedada · ${formatDuration(s.durationMin)} · ${intensityLabel(s.intensity)}`, 'Plan de Road to Ironman'].join('\n'),
    date: s.date,
    startTime: s.startTime,
    durationMin: s.durationMin,
    categories: [sportLabel(s.sport), 'Quedada'],
    location: s.location,
    status: 'CONFIRMED',
  };
}

export interface FeedInput extends PrescriptionOptions {
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
    ...visible.map((w) => workoutEvent(w, input.jointSessions, input.userId, input.now, input)),
    ...extraJoint.map((s) => jointEvent(s, input.userId, input.now)),
  ].sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  return buildCalendar(events, input.calendarName ?? 'Road to Ironman');
}
