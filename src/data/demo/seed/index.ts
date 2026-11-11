/**
 * Builds the demo database relative to "today" (computed at seed time):
 * Diego (me) and Álex (friend) with races, 4 weeks of history + next week of
 * concrete catalog sessions (targets from their thresholds, cues, objective,
 * plan B), busy blocks, a pádel match, 28 days of check-ins/metrics, quedadas,
 * feed, notifications, a pending rules proposal and one adjusted week in the
 * season plan.
 */
import { addDays, startOfWeek } from '@/domain/dates';
import { nextRace } from '@/domain/periodization';
import type { Profile, Race, UUID } from '@/domain/types';

import { DEMO_DB_VERSION, type DemoClock, type DemoDb, type DemoWeekPlan } from '../db';
import { DEMO_USERS, createRandom } from '../ids';
import { seedBusyBlocks, seedLifeEvents, seedRaces } from './planning';
import { seedProfiles } from './profiles';
import { seedFeed, seedFriendships, seedJointSessions, seedNotifications, seedProposal } from './social';
import { ALEX_WEEK, DIEGO_WEEK, type SessionTemplate } from './templates';
import { seedCheckins, seedMetrics, seedNutrition } from './wellness';
import { seedWorkouts, skipOne, type SeedAthlete, type SeedWeek } from './workouts';

const SEED = 20261025;
/** The adjusted week of the seed: exams of the master's, five weeks from now. */
const EXAM_WEEK_OFFSET = 5;

function weeks(weekStart: string, offsets: number[], scales: number[]): SeedWeek[] {
  return offsets.map((k, i) => ({ weekStart: addDays(weekStart, 7 * k), scale: scales[i] ?? 1 }));
}

function athlete(userId: UUID, templates: readonly SessionTemplate[], profiles: readonly Profile[], races: readonly Race[], today: string): SeedAthlete {
  return {
    userId,
    templates,
    thresholds: profiles.find((p) => p.id === userId)?.thresholds ?? {},
    raceDistance: nextRace(races.filter((r) => r.userId === userId), today)?.distance ?? null,
  };
}

/** Plan → General shows one week the athlete adjusted (a descarga for exams). */
function seedWeekPlans(clock: DemoClock, weekStart: string): DemoWeekPlan[] {
  return [
    {
      userId: DEMO_USERS.diego,
      weekStart: addDays(weekStart, EXAM_WEEK_OFFSET * 7),
      kind: 'recovery',
      targetMinutes: null,
      note: 'Exámenes del máster: lo justo para no perder el hilo.',
      source: 'manual',
      updatedAt: clock.now,
    },
  ];
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
    jointComments: [],
    feed: [],
    kudos: [],
    notifications: [],
    pushTokens: [],
    proposals: [],
    tokens: [],
    integrations: [],
    briefings: [],
    weekPlans: [],
  };
}

export function buildSeed(clock: DemoClock): DemoDb {
  const rand = createRandom(SEED);
  const weekStart = startOfWeek(clock.today);
  const longAgo = new Date(Date.parse(clock.now) - 90 * 86_400_000).toISOString();
  const profiles = seedProfiles(longAgo);
  const races = seedRaces(clock, longAgo);
  const diego = athlete(DEMO_USERS.diego, DIEGO_WEEK, profiles, races, clock.today);
  const alex = athlete(DEMO_USERS.alex, ALEX_WEEK, profiles, races, clock.today);
  const diegoWorkouts = seedWorkouts(diego, weeks(weekStart, [-3, -2, -1, 0, 1], [0.85, 0.9, 0.95, 1, 1.05]), clock, rand);
  const alexWorkouts = seedWorkouts(alex, weeks(weekStart, [-1, 0, 1], [0.95, 1, 1.05]), clock, rand);
  const friendships = seedFriendships(clock);

  const base: DemoDb = {
    ...emptyDb(clock),
    profiles,
    workouts: [...diegoWorkouts, ...alexWorkouts],
    races,
    lifeEvents: seedLifeEvents(clock, weekStart),
    busyBlocks: seedBusyBlocks(clock, weekStart),
    checkins: seedCheckins(DEMO_USERS.diego, clock.today, rand),
    metrics: seedMetrics(DEMO_USERS.diego, clock.today, rand),
    nutrition: seedNutrition(DEMO_USERS.diego, clock.today, clock),
    friendships,
    weekPlans: seedWeekPlans(clock, weekStart),
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
  const proposal = seedProposal(withFeed, clock, weekStart, diego);
  const lucia = friendships.find((f) => f.requesterId === DEMO_USERS.lucia);
  return seedNotifications({ ...withFeed, proposals: [proposal] }, clock, {
    pending,
    confirmed,
    luciaFriendshipId: lucia?.id ?? '',
  });
}
