/**
 * How a workout reaches the AI coach and Claude: ids, schedule, load, the main
 * set with its numbers (`targets`, mirrored prescription `targetSummary`) and
 * the coach's prescription; completed sessions add what was done and a plan vs
 * done line. Compact: 'concise' keeps the objective only, 'detailed' adds the
 * full prescription of upcoming sessions, the description and the raw steps.
 */
import { weekdayOf, WEEKDAYS_ES } from '../dates.ts';
import type { ISODate, JointSession, RaceDistance, Thresholds, UUID, Workout, WorkoutCoaching } from '../types.ts';
import { targetSummary } from './domain/prescription.ts';
import { intensityLabel, sportLabel } from './labels.ts';
import { workoutLoad } from './load.ts';
import { doneVsPlan } from './review.ts';

export type Detail = 'concise' | 'detailed';

export interface WorkoutView {
  id: UUID;
  date: ISODate;
  weekday: string;
  startTime: string | null;
  sport: Workout['sport'];
  sportLabel: string;
  title: string;
  durationMin: number;
  distanceM: number | null;
  intensity: Workout['intensity'];
  intensityLabel: string;
  status: Workout['status'];
  isKey: boolean;
  jointSessionId: UUID | null;
  partners?: string[];
  load: number;
  /** Main set and its numbers: "3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8". */
  targets?: string;
  /** The coach's objective (concise, past sessions). */
  objective?: string;
  /** Full prescription of upcoming sessions (detailed). */
  coaching?: WorkoutCoaching;
  completed?: Record<string, unknown>;
  /** "FC media 156 ppm (plan 142–150 ppm: por encima) · RPE 6 (plan 3–4: por encima) · sensaciones 2/5". */
  planVsDone?: string;
  description?: string | null;
  steps?: Workout['steps'];
}

export interface ViewContext {
  detail: Detail;
  sessions: readonly JointSession[];
  userId: UUID;
  thresholds: Thresholds;
  /** Target race distance: what "ritmo de carrera" means in the targets. */
  raceDistance: RaceDistance | null;
  today: ISODate;
}

function partnersFor(w: Workout, sessions: readonly JointSession[], userId: UUID): string[] | undefined {
  if (!w.jointSessionId) return undefined;
  const session = sessions.find((s) => s.id === w.jointSessionId);
  if (!session) return undefined;
  return session.participants.filter((p) => p.userId !== userId && p.status !== 'declined').map((p) => p.displayName);
}

function prescriptionOf(w: Workout, ctx: ViewContext): Pick<WorkoutView, 'targets' | 'objective' | 'coaching'> {
  const targets = targetSummary(w, ctx.thresholds, { raceDistance: ctx.raceDistance });
  const coaching = w.coaching ?? null;
  const upcoming = w.status === 'planned' && w.date >= ctx.today;
  const full = coaching !== null && ctx.detail === 'detailed' && upcoming;
  return {
    ...(targets ? { targets } : {}),
    ...(coaching && !full ? { objective: coaching.objective } : {}),
    ...(full ? { coaching } : {}),
  };
}

function doneOf(w: Workout, ctx: ViewContext): Pick<WorkoutView, 'completed' | 'planVsDone'> {
  const c = w.completed;
  if (!c) return {};
  const review = doneVsPlan(w, { thresholds: ctx.thresholds, raceDistance: ctx.raceDistance });
  return {
    completed: { durationMin: c.durationMin, distanceM: c.distanceM, avgHr: c.avgHr, rpe: c.rpe, feel: c.feel, tss: c.tss, source: c.source },
    ...(review ? { planVsDone: review.line } : {}),
  };
}

export function workoutView(w: Workout, ctx: ViewContext): WorkoutView {
  const partners = partnersFor(w, ctx.sessions, ctx.userId);
  return {
    id: w.id,
    date: w.date,
    weekday: WEEKDAYS_ES[weekdayOf(w.date)],
    startTime: w.startTime,
    sport: w.sport,
    sportLabel: sportLabel(w.sport),
    title: w.title,
    durationMin: w.durationMin,
    distanceM: w.distanceM,
    intensity: w.intensity,
    intensityLabel: intensityLabel(w.intensity),
    status: w.status,
    isKey: w.isKey,
    jointSessionId: w.jointSessionId,
    ...(partners && partners.length ? { partners } : {}),
    load: workoutLoad(w),
    ...prescriptionOf(w, ctx),
    ...doneOf(w, ctx),
    ...(ctx.detail === 'detailed' ? { description: w.description, steps: w.steps } : {}),
  };
}
