import { addDays, formatDayLabel, weekdayOf } from '@/domain/dates';
import type { ISODate, ISODateTime, PlanChange, PlanProposal, Weekday, Workout } from '@/domain/types';

import type { DemoClock, DemoDb, DemoFriendship, DemoJointSession } from '../db';
import { feedForCompletion, feedForRace, notify } from '../events';
import { feedForJointConfirmed } from '../jointOps';
import { DEMO_USERS } from '../ids';
import { linkJointWorkout } from './workouts';

function daysAgoIso(clock: DemoClock, days: number, hours = 0): ISODateTime {
  return new Date(Date.parse(clock.now) - (days * 24 + hours) * 3_600_000).toISOString();
}

/** First date strictly after `date` that falls on `weekday`. */
export function nextWeekdayAfter(date: ISODate, weekday: Weekday): ISODate {
  const offset = ((weekday - weekdayOf(date) + 7) % 7) || 7;
  return addDays(date, offset);
}

export function seedFriendships(clock: DemoClock): DemoFriendship[] {
  return [
    {
      id: clock.newId(),
      requesterId: DEMO_USERS.alex,
      addresseeId: DEMO_USERS.diego,
      status: 'accepted',
      createdAt: daysAgoIso(clock, 60),
      respondedAt: daysAgoIso(clock, 60),
    },
    {
      id: clock.newId(),
      requesterId: DEMO_USERS.lucia,
      addresseeId: DEMO_USERS.diego,
      status: 'pending',
      createdAt: daysAgoIso(clock, 0, 5),
      respondedAt: null,
    },
  ];
}

function sessionBase(clock: DemoClock): Pick<DemoJointSession, 'id' | 'createdAt' | 'notes'> {
  return { id: clock.newId(), createdAt: daysAgoIso(clock, 2), notes: null };
}

/** Confirmed long ride (Diego organises) + pending track session invite from Álex. */
export function seedJointSessions(db: DemoDb, clock: DemoClock): { db: DemoDb; confirmedId: string; pendingId: string } {
  const ride: DemoJointSession = {
    ...sessionBase(clock),
    organizerId: DEMO_USERS.diego,
    sport: 'bike',
    date: nextWeekdayAfter(clock.today, 5),
    startTime: '08:30',
    durationMin: 180,
    intensity: 'endurance',
    title: 'Tirada larga en bici',
    location: 'Salida desde Moncloa',
    notes: 'Ruta por El Pardo y la Cuesta de las Perdices. Café a la vuelta.',
    status: 'confirmed',
    participants: [],
  };
  const track: DemoJointSession = {
    ...sessionBase(clock),
    organizerId: DEMO_USERS.alex,
    sport: 'run',
    date: nextWeekdayAfter(clock.today, 3),
    startTime: '19:00',
    durationMin: 50,
    intensity: 'vo2',
    title: "Series en el Retiro: 6×1'",
    location: 'Parque del Retiro · puerta de Felipe V',
    status: 'proposed',
    participants: [],
  };
  const link = (workouts: readonly Workout[], userId: string, s: DemoJointSession) =>
    linkJointWorkout(workouts, userId, { ...s, sessionId: s.id }, clock);

  const a = link(db.workouts, DEMO_USERS.diego, ride);
  const b = link(a.workouts, DEMO_USERS.alex, ride);
  const c = link(b.workouts, DEMO_USERS.alex, track);
  const responded = daysAgoIso(clock, 1);
  const sessions: DemoJointSession[] = [
    {
      ...ride,
      participants: [
        { userId: DEMO_USERS.diego, status: 'accepted', workoutId: a.workoutId, respondedAt: ride.createdAt },
        { userId: DEMO_USERS.alex, status: 'accepted', workoutId: b.workoutId, respondedAt: responded },
      ],
    },
    {
      ...track,
      participants: [
        { userId: DEMO_USERS.alex, status: 'accepted', workoutId: c.workoutId, respondedAt: track.createdAt },
        { userId: DEMO_USERS.diego, status: 'invited', workoutId: null, respondedAt: null },
      ],
    },
  ];
  return { db: { ...db, workouts: c.workouts, jointSessions: sessions }, confirmedId: ride.id, pendingId: track.id };
}

function latestCompleted(db: DemoDb, userId: string, count: number): Workout[] {
  return db.workouts
    .filter((w) => w.userId === userId && w.status === 'completed')
    .sort((x, y) => (x.completed?.completedAt ?? x.date).localeCompare(y.completed?.completedAt ?? y.date))
    .slice(-count);
}

export function seedFeed(db: DemoDb, clock: DemoClock, confirmed: DemoJointSession): DemoDb {
  const alexRace = db.races.find((r) => r.userId === DEMO_USERS.alex && r.priority === 'A');
  const withRace = alexRace ? feedForRace(db, alexRace, clock, daysAgoIso(clock, 10)) : db;
  const completions = [...latestCompleted(db, DEMO_USERS.diego, 1), ...latestCompleted(db, DEMO_USERS.alex, 2)];
  const withWorkouts = completions.reduce(
    (acc, w) => feedForCompletion(acc, w, clock, w.completed?.completedAt),
    withRace,
  );
  const withJoint = feedForJointConfirmed(withWorkouts, confirmed, clock, daysAgoIso(clock, 1));
  const byActor = (actor: string) => withJoint.feed.find((e) => e.actorId === actor && e.type === 'workout_completed');
  const alexEvent = byActor(DEMO_USERS.alex);
  const diegoEvent = byActor(DEMO_USERS.diego);
  const kudos = [
    ...(alexEvent ? [{ eventId: alexEvent.id, userId: DEMO_USERS.diego, createdAt: clock.now }] : []),
    ...(diegoEvent ? [{ eventId: diegoEvent.id, userId: DEMO_USERS.alex, createdAt: clock.now }] : []),
  ];
  return { ...withJoint, kudos, feed: [...withJoint.feed].sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
}

function findWorkout(db: DemoDb, date: ISODate, sport: Workout['sport']): Workout | undefined {
  return db.workouts.find((w) => w.userId === DEMO_USERS.diego && w.date === date && w.sport === sport && w.jointSessionId === null);
}

/** Pending rules proposal for next week (after the pádel match). */
export function seedProposal(db: DemoDb, clock: DemoClock, weekStart: ISODate): PlanProposal {
  const next = addDays(weekStart, 7);
  const tuesdayRun = findWorkout(db, addDays(next, 1), 'run');
  const thursdayStrength = findWorkout(db, addDays(next, 3), 'strength');
  const changes: PlanChange[] = [
    ...(tuesdayRun
      ? [{ op: 'update' as const, workoutId: tuesdayRun.id, patch: { title: 'Rodaje suave Z2', intensity: 'endurance' as const, durationMin: 45 }, reason: 'El pádel suma carga intensa: cambiamos los cambios de ritmo por un rodaje suave.' }]
      : []),
    ...(thursdayStrength
      ? [{ op: 'move' as const, workoutId: thursdayStrength.id, toDate: addDays(next, 4), toStartTime: '07:30', reason: 'Separamos la fuerza del día de series para llegar más fresco.' }]
      : []),
    {
      op: 'add',
      workout: { date: addDays(next, 2), startTime: '07:15', sport: 'mobility', title: 'Movilidad de cadera y tobillo', durationMin: 20, intensity: 'recovery', source: 'rules' },
      reason: 'Movilidad suave para descargar las piernas tras el pádel.',
    },
  ];
  return {
    id: clock.newId(),
    userId: DEMO_USERS.diego,
    kind: 'replan',
    source: 'rules',
    weekStart: next,
    summary: 'Ajustes tras el pádel: suavizo el martes, separo la fuerza del día de series y añado movilidad.',
    changes,
    status: 'pending',
    model: null,
    createdAt: daysAgoIso(clock, 0, 1),
  };
}

function whenLabel(s: Pick<DemoJointSession, 'date' | 'startTime'>, today: ISODate): string {
  return `${formatDayLabel(s.date, today)}${s.startTime ? ` · ${s.startTime}` : ''}`;
}

/**
 * Inbox of the seeded athlete. No 'plan_updated' for the seeded proposal: it
 * comes from the rules engine, and the DB trigger only notifies proposals from
 * 'claude' / 'ai_coach' (as does the demo `createProposal`).
 */
export function seedNotifications(
  db: DemoDb,
  clock: DemoClock,
  refs: { pending: DemoJointSession; confirmed: DemoJointSession; luciaFriendshipId: string },
): DemoDb {
  const me = DEMO_USERS.diego;
  const { pending, confirmed } = refs;
  const steps = [
    { type: 'kudos' as const, title: 'Álex te ha dado kudos', body: 'Por tu entreno', data: { url: '/together', fromUserId: DEMO_USERS.alex }, createdAt: daysAgoIso(clock, 1, 2), readAt: clock.now },
    { type: 'joint_response' as const, title: `Álex se apunta a «${confirmed.title}»`, body: whenLabel(confirmed, clock.today), data: { url: `/joint/${confirmed.id}`, jointSessionId: confirmed.id, fromUserId: DEMO_USERS.alex, accepted: true }, createdAt: daysAgoIso(clock, 1), readAt: clock.now },
    { type: 'friend_request' as const, title: 'Nueva solicitud de amistad', body: 'Lucía (@lucia) quiere entrenar contigo.', data: { url: '/together', friendshipId: refs.luciaFriendshipId, fromUserId: DEMO_USERS.lucia }, createdAt: daysAgoIso(clock, 0, 5) },
    { type: 'joint_invite' as const, title: 'Álex te invita a entrenar', body: `${pending.title} · ${whenLabel(pending, clock.today)}`, data: { url: `/joint/${pending.id}`, jointSessionId: pending.id, fromUserId: DEMO_USERS.alex }, createdAt: daysAgoIso(clock, 0, 3) },
  ];
  return steps.reduce((acc, n) => notify(acc, me, n, clock), db);
}
