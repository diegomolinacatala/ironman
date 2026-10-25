/**
 * Builds the demo database relative to "today" (computed at seed time):
 * Diego (me) and Álex (friend) with races, 4 weeks of history + next week,
 * busy blocks, a pádel match, 28 days of check-ins/metrics, quedadas, feed,
 * notifications and a pending rules proposal.
 */
import { addDays, startOfWeek } from '@/domain/dates';

import { DEMO_DB_VERSION, type DemoClock, type DemoDb } from '../db';
import { DEMO_USERS, createRandom } from '../ids';
import { seedBusyBlocks, seedLifeEvents, seedRaces } from './planning';
import { seedProfiles } from './profiles';
import { seedFeed, seedFriendships, seedJointSessions, seedNotifications, seedProposal } from './social';
import { ALEX_WEEK, DIEGO_WEEK } from './templates';
import { seedCheckins, seedMetrics, seedNutrition } from './wellness';
import { seedWorkouts, skipOne, type SeedWeek } from './workouts';

const SEED = 20261025;

function weeks(weekStart: string, offsets: number[], scales: number[]): SeedWeek[] {
  return offsets.map((k, i) => ({ weekStart: addDays(weekStart, 7 * k), scale: scales[i] ?? 1 }));
}

function emptyDb(clock: DemoClock): DemoDb {
  return {
    version: DEMO_DB_VERSION,
    seededOn: clock.today,
    meId: DEMO_USERS.diego,
    profiles: [],
    workouts: [],
    races: [],
    lifeEvents: [],
    busyBlocks: [],
    checkins: [],
    metrics: [],
    nutrition: [],
    friendships: [],
    jointSessions: [],
    feed: [],
    kudos: [],
    notifications: [],
    pushTokens: [],
    proposals: [],
    tokens: [],
    integrations: [],
  };
}

export function buildSeed(clock: DemoClock): DemoDb {
  const rand = createRandom(SEED);
  const weekStart = startOfWeek(clock.today);
  const longAgo = new Date(Date.parse(clock.now) - 90 * 86_400_000).toISOString();
  const diegoWorkouts = seedWorkouts(DEMO_USERS.diego, DIEGO_WEEK, weeks(weekStart, [-3, -2, -1, 0, 1], [0.85, 0.9, 0.95, 1, 1.05]), clock, rand);
  const alexWorkouts = seedWorkouts(DEMO_USERS.alex, ALEX_WEEK, weeks(weekStart, [-1, 0, 1], [0.95, 1, 1.05]), clock, rand);
  const friendships = seedFriendships(clock);

  const base: DemoDb = {
    ...emptyDb(clock),
    profiles: seedProfiles(longAgo),
    workouts: [...diegoWorkouts, ...alexWorkouts],
    races: seedRaces(clock, longAgo),
    lifeEvents: seedLifeEvents(clock, weekStart),
    busyBlocks: seedBusyBlocks(clock, weekStart),
    checkins: seedCheckins(DEMO_USERS.diego, clock.today, rand),
    metrics: seedMetrics(DEMO_USERS.diego, clock.today, rand),
    nutrition: seedNutrition(DEMO_USERS.diego, clock.today, clock),
    friendships,
  };

  const joint = seedJointSessions(base, clock);
  const diegoOnly = joint.db.workouts.filter((w) => w.userId === DEMO_USERS.diego);
  const others = joint.db.workouts.filter((w) => w.userId !== DEMO_USERS.diego);
  const withSkip: DemoDb = {
    ...joint.db,
    workouts: [...skipOne(diegoOnly, clock.today, 'Me surgió una entrega del máster.'), ...others],
  };
  const confirmed = withSkip.jointSessions.find((s) => s.id === joint.confirmedId);
  const pending = withSkip.jointSessions.find((s) => s.id === joint.pendingId);
  if (!confirmed || !pending) return withSkip;

  const withFeed = seedFeed(withSkip, clock, confirmed);
  const proposal = seedProposal(withFeed, clock, weekStart);
  const lucia = friendships.find((f) => f.requesterId === DEMO_USERS.lucia);
  return seedNotifications({ ...withFeed, proposals: [proposal] }, clock, {
    pending,
    confirmed,
    luciaFriendshipId: lucia?.id ?? '',
  });
}
