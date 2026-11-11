/**
 * How the briefing shows each session to the model. Today's sessions carry the
 * coach's prescription (objective, keys, success, plan B), the main set with
 * the athlete's numbers (mirrored `targetSummary`), how it should feel
 * (`sessionFeel`) and the structure step by step; tomorrow's sessions fit in a
 * line; yesterday's add planned vs done (FC media vs the expected range, RPE,
 * sensaciones: planning/review.ts). Device-neutral and compact. Pure.
 */
import { sessionFeel, stepLines, targetSummary } from '../planning/domain/prescription.ts';
import type { StepLine } from '../planning/domain/prescription.ts';
import { intensityLabel, sportLabel } from '../planning/labels.ts';
import { doneVsPlan } from '../planning/review.ts';
import type { RaceDistance, Thresholds, Workout } from '../types.ts';

export interface SessionView {
  thresholds: Thresholds;
  /** Target race distance: what "ritmo de carrera" means in the targets. */
  raceDistance: RaceDistance | null;
}

type PromptSession = Record<string, unknown>;

function baseOf(w: Workout): PromptSession {
  return {
    title: w.title,
    sport: sportLabel(w.sport),
    startTime: w.startTime,
    durationMin: w.durationMin,
    distanceM: w.distanceM,
    intensity: intensityLabel(w.intensity),
    isKey: w.isKey,
    status: w.status,
  };
}

/**
 * "3×8' · series · Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8 · Solo palabras sueltas".
 * Only work steps carry numbers (the script names one target; fewer tokens).
 */
function stepText(line: StepLine): string {
  const targets = line.kind === 'work' ? line.targets : [];
  return [line.amount, line.label.toLowerCase(), line.zone, ...targets, line.cue ?? '', line.note ?? ''].filter(Boolean).join(' · ');
}

function doneOf(w: Workout, view: SessionView): PromptSession {
  const c = w.completed;
  if (!c) return {};
  const review = doneVsPlan(w, { thresholds: view.thresholds, raceDistance: view.raceDistance });
  return {
    done: { durationMin: c.durationMin, distanceM: c.distanceM, avgHr: c.avgHr, rpe: c.rpe, feel: c.feel },
    ...(review ? { planVsDone: review.line } : {}),
  };
}

const objectiveOf = (w: Workout): PromptSession => (w.coaching?.objective ? { objective: w.coaching.objective } : {});

/** A session of the briefing's day: targets, sensations, prescription and structure. */
export function todaySession(w: Workout, view: SessionView): PromptSession {
  if (w.sport === 'rest') return baseOf(w);
  const opts = { raceDistance: view.raceDistance };
  const targets = targetSummary(w, view.thresholds, opts);
  const coaching = w.coaching ?? null;
  const structure = stepLines(w, view.thresholds, opts).map(stepText);
  return {
    ...baseOf(w),
    ...(w.description ? { description: w.description } : {}),
    ...(targets ? { targets } : {}),
    feel: sessionFeel(w, view.thresholds, opts),
    ...(coaching ? { coaching: { objective: coaching.objective, keys: coaching.keys, success: coaching.success, planB: coaching.planB } } : {}),
    ...(structure.length ? { structure } : {}),
    ...doneOf(w, view),
  };
}

/** A session of the next day, in one line: main set and objective. */
export function tomorrowSession(w: Workout, view: SessionView): PromptSession {
  const targets = w.sport === 'rest' ? null : targetSummary(w, view.thresholds, { raceDistance: view.raceDistance });
  return { ...baseOf(w), ...(targets ? { targets } : {}), ...objectiveOf(w) };
}

/** A session done the day before: what was done and how it compares with the plan. */
export function yesterdaySession(w: Workout, view: SessionView): PromptSession {
  return { ...baseOf(w), ...objectiveOf(w), ...doneOf(w, view) };
}
