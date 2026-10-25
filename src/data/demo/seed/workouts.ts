import { addDays } from '@/domain/dates';
import type { CompletedData, Intensity, ISODate, Sport, UUID, Workout } from '@/domain/types';

import type { DemoClock } from '../db';
import { localIso } from '../ids';
import type { WorkoutTemplate } from './templates';

export interface SeedWeek {
  weekStart: ISODate;
  /** Volume multiplier for this week (progression). */
  scale: number;
}

const BASE_RPE: Record<Intensity, number> = {
  recovery: 3,
  endurance: 4,
  tempo: 6,
  threshold: 7,
  vo2: 8,
  race: 8,
};

const AVG_HR: Record<Intensity, number> = {
  recovery: 118,
  endurance: 136,
  tempo: 152,
  threshold: 162,
  vo2: 166,
  race: 158,
};

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

function rpeFor(sport: Sport, intensity: Intensity, rand: () => number): number {
  if (sport === 'strength' || sport === 'mobility') return 5;
  return Math.min(10, BASE_RPE[intensity] + (rand() < 0.4 ? 1 : 0));
}

function completedData(w: Workout, rand: () => number): CompletedData {
  const durationMin = Math.max(10, Math.round(w.durationMin * (0.92 + rand() * 0.14)));
  const distanceM = w.distanceM === null ? undefined : Math.round((w.distanceM * durationMin) / Math.max(1, w.durationMin));
  const startIso = localIso(w.date, w.startTime ?? '18:00');
  return {
    durationMin,
    ...(distanceM !== undefined ? { distanceM } : {}),
    ...(w.sport === 'strength' ? {} : { avgHr: AVG_HR[w.intensity] + Math.round(rand() * 6) - 3 }),
    rpe: rpeFor(w.sport, w.intensity, rand),
    source: w.sport === 'strength' ? 'manual' : 'garmin',
    completedAt: new Date(Date.parse(startIso) + durationMin * 60_000).toISOString(),
  };
}

function fromTemplate(t: WorkoutTemplate, week: SeedWeek, userId: UUID, clock: DemoClock): Workout {
  return {
    id: clock.newId(),
    userId,
    date: addDays(week.weekStart, t.weekday),
    startTime: t.start,
    sport: t.sport,
    title: t.title,
    description: t.description ?? null,
    durationMin: roundTo(t.durationMin * week.scale, 5),
    distanceM: t.distanceM === undefined ? null : roundTo(t.distanceM * week.scale, t.sport === 'swim' ? 100 : 500),
    intensity: t.intensity,
    tss: null,
    steps: t.steps ?? [],
    status: 'planned',
    completed: null,
    source: 'rules',
    isKey: t.isKey ?? false,
    jointSessionId: null,
    externalId: null,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
}

/** Expands templates over weeks; past sessions come back completed (with RPE). */
export function seedWorkouts(
  userId: UUID,
  templates: readonly WorkoutTemplate[],
  weeks: readonly SeedWeek[],
  clock: DemoClock,
  rand: () => number,
): Workout[] {
  return weeks.flatMap((week) =>
    templates.map((t) => {
      const planned = fromTemplate(t, week, userId, clock);
      if (planned.date >= clock.today) return planned;
      return { ...planned, status: 'completed' as const, completed: completedData(planned, rand) };
    }),
  );
}

/** Marks the most recent past, non-key, non-joint session as skipped (realism). */
export function skipOne(workouts: readonly Workout[], today: ISODate, reason: string): Workout[] {
  const candidate = [...workouts]
    .filter((w) => w.date < today && !w.isKey && w.jointSessionId === null)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))[0];
  if (!candidate) return [...workouts];
  return workouts.map((w) =>
    w.id === candidate.id ? { ...w, status: 'skipped' as const, completed: { notes: reason } } : w,
  );
}

export interface JointLink {
  sessionId: UUID;
  date: ISODate;
  sport: Sport;
  startTime: string | null;
  title: string;
  durationMin: number;
  intensity: Intensity;
}

/**
 * Links (or creates) the participant's workout for a quedada: same day and
 * sport → becomes the joint workout. Returns the new list and the workout id.
 */
export function linkJointWorkout(
  workouts: readonly Workout[],
  userId: UUID,
  link: JointLink,
  clock: DemoClock,
): { workouts: Workout[]; workoutId: UUID } {
  const existing = workouts.find((w) => w.userId === userId && w.date === link.date && w.sport === link.sport);
  const joined = (w: Workout): Workout => ({
    ...w,
    title: link.title,
    startTime: link.startTime,
    durationMin: link.durationMin,
    intensity: link.intensity,
    source: 'joint',
    jointSessionId: link.sessionId,
  });
  if (existing) {
    return { workouts: workouts.map((w) => (w.id === existing.id ? joined(w) : w)), workoutId: existing.id };
  }
  const created = joined({
    id: clock.newId(),
    userId,
    date: link.date,
    startTime: link.startTime,
    sport: link.sport,
    title: link.title,
    description: null,
    durationMin: link.durationMin,
    distanceM: null,
    intensity: link.intensity,
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'joint',
    isKey: false,
    jointSessionId: link.sessionId,
    externalId: null,
    createdAt: clock.now,
    updatedAt: clock.now,
  });
  return { workouts: [...workouts, created], workoutId: created.id };
}
