// GENERATED MIRROR of the domain types used by the mirrored modules — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * Re-exports the edge-function type mirror (../../types.ts) plus the two
 * calendar types the mirrored date helpers need.
 */
export type {
  AthleteLevel,
  FixedWeeklySession,
  Intensity,
  IntensityModel,
  ISODate,
  NumberRange,
  PrefSport,
  Race,
  RaceDistance,
  RacePrep,
  Sport,
  StepTarget,
  Thresholds,
  TrainableSport,
  TrainingPrefs,
  WeekPlan,
  WeekPlanDraft,
  WeekPlanKind,
  WorkoutCoaching,
  WorkoutStatus,
  WorkoutStep,
  WorkoutStepKind,
} from '../../types.ts';

import type { ISODate } from '../../types.ts';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
