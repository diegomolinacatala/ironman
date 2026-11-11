import { addDays } from '@/domain/dates';
import { specToDraft } from '@/domain/sessions';
import type { CompletedData, Intensity, ISODate, RaceDistance, Score5, Sport, Thresholds, UUID, Workout, WorkoutStep } from '@/domain/types';
import { sessionHrRange, sessionRpe } from '@/domain/zones';

import type { DemoClock } from '../db';
import { localIso } from '../ids';
import { draftToWorkout } from '../repo/workoutsDemo';
import type { SessionTemplate } from './templates';

export interface SeedWeek {
  weekStart: ISODate;
  /** Volume multiplier for this week (progression). */
  scale: number;
}

/** A demo athlete's week and what their targets are computed from. */
export interface SeedAthlete {
  userId: UUID;
  templates: readonly SessionTemplate[];
  thresholds: Thresholds;
  /** Distance of the target race ("ritmo de carrera"). */
  raceDistance: RaceDistance | null;
}

/** Swim HR is not prescribed (no target range): a plausible watch average per intensity. */
const SWIM_AVG_HR: Record<Intensity, number> = {
  recovery: 118,
  endurance: 132,
  tempo: 146,
  threshold: 154,
  vo2: 160,
  race: 150,
};

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/** Total metres of a swim whose steps are all distance-based, else null. */
function setsDistance(steps: readonly WorkoutStep[]): number | null {
  if (steps.length === 0 || steps.some((s) => !s.distanceM)) return null;
  return steps.reduce((sum, s) => sum + (s.distanceM ?? 0) * (s.repeat && s.repeat > 1 ? s.repeat : 1), 0);
}

/** Watch average HR inside the expected range of the session (warm-up and recoveries included). */
function averageHr(w: Workout, athlete: SeedAthlete, rand: () => number): number | null {
  if (w.sport === 'strength' || w.sport === 'mobility') return null;
  const range = sessionHrRange(w, athlete.thresholds, { raceDistance: athlete.raceDistance });
  if (!range) return SWIM_AVG_HR[w.intensity] + Math.round(rand() * 6) - 3;
  return Math.round(range.min + (range.max - range.min) * (0.2 + rand() * 0.6));
}

function rpeFor(w: Workout, athlete: SeedAthlete, rand: () => number): number {
  const range = sessionRpe(w, { raceDistance: athlete.raceDistance });
  return Math.min(10, Math.max(1, Math.round(range.min + (range.max - range.min) * rand())));
}

/** Mostly "bien" (4), sometimes "normal" (3) or "genial" (5). */
function feelFor(rand: () => number): Score5 {
  const roll = rand();
  if (roll < 0.2) return 3;
  return roll < 0.8 ? 4 : 5;
}

function completedData(w: Workout, athlete: SeedAthlete, rand: () => number): CompletedData {
  const durationMin = Math.max(10, Math.round(w.durationMin * (0.92 + rand() * 0.14)));
  const distanceM = w.distanceM === null ? undefined : Math.round((w.distanceM * durationMin) / Math.max(1, w.durationMin));
  const startIso = localIso(w.date, w.startTime ?? '18:00');
  const avgHr = averageHr(w, athlete, rand);
  return {
    durationMin,
    ...(distanceM !== undefined ? { distanceM } : {}),
    ...(avgHr !== null ? { avgHr } : {}),
    rpe: rpeFor(w, athlete, rand),
    feel: feelFor(rand),
    source: w.sport === 'strength' ? 'manual' : 'garmin',
    completedAt: new Date(Date.parse(startIso) + durationMin * 60_000).toISOString(),
  };
}

/** The catalog session of `t` for that week, built like the rules engine does (source 'rules'). */
function plannedFrom(t: SessionTemplate, week: SeedWeek, athlete: SeedAthlete, clock: DemoClock): Workout {
  const durationMin = roundTo(t.spec.durationMin * week.scale, 5);
  const distanceM = t.distanceM === undefined ? null : roundTo(t.distanceM * week.scale, 500);
  const spec = { ...t.spec, durationMin, distanceM };
  const date = addDays(week.weekStart, t.weekday);
  const draft = specToDraft(spec, date, t.start, { thresholds: athlete.thresholds, raceDistance: athlete.raceDistance });
  return draftToWorkout({ ...draft, distanceM: draft.distanceM ?? setsDistance(draft.steps ?? []) }, athlete.userId, clock);
}

/** Expands the athlete's week over `weeks`; past sessions come back completed (FC media, RPE, sensaciones). */
export function seedWorkouts(athlete: SeedAthlete, weeks: readonly SeedWeek[], clock: DemoClock, rand: () => number): Workout[] {
  return weeks.flatMap((week) =>
    athlete.templates.map((t) => {
      const planned = plannedFrom(t, week, athlete, clock);
      if (planned.date >= clock.today) return planned;
      return { ...planned, status: 'completed' as const, completed: completedData(planned, athlete, rand) };
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
